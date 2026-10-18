// Tour 360 em que se anda. Cada quarto e um panorama
// equirretangular com um mapa de distancia (assets/tour/<no>-d.png). O
// panorama nao e projetado numa esfera lisa: cada vertice da esfera vai para a
// distancia que o mapa diz, entao chao, paredes, mesas e baloes ficam onde
// estao na foto. Com a camera fora do centro a paralaxe e real, e da para
// andar dentro do espaco. As portas levam de um espaco a outro.
//
// Decisoes:
// - three.js entra por import dinamico no clique em "Entrar": quem so le a
//   pagina nao baixa 760 KB.
// - Clique ou toque no chao anda ate la; arrastar gira. Teclado: setas e WASD.
//   Botoes de andar e girar como alternativa ao arraste (WCAG 2.5.7).
// - Andar tem limite: perto da borda do que a foto mostra a malha estica.
// - Movimento reduzido: sem balanco de passo e troca de espaco por corte.
// - Tudo o que o tour mostra tambem esta escrito na lista de espacos da pagina.

const ALTURA = 1.4, DMIN = 0.3, DMAX = 40;   // iguais ao script que gera os mapas
const FOLGA = 1.4;                           // distancia minima de parede, em metros

const raiz = document.querySelector('[data-tour]');
if (raiz) iniciar(raiz);

function iniciar(raiz) {
  const dados = JSON.parse(document.getElementById('tour-dados').textContent);
  const palco = raiz.querySelector('[data-tour-palco]');
  const canvas = raiz.querySelector('canvas');
  const entrar = raiz.querySelector('[data-tour-entrar]');
  const estado = raiz.querySelector('[data-tour-status]');
  const titulo = raiz.querySelector('[data-tour-onde]');
  const camadaPortas = raiz.querySelector('[data-tour-portas]');
  const veu = raiz.querySelector('[data-tour-veu]');
  const aviso = raiz.querySelector('[data-tour-aviso]');
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = new URL('../', import.meta.url);

  let THREE, renderer, cena, cenaB, camera, malha, anel = null, cursor, transicao = null;
  let atual = null, ocupado = false, ativo = false;
  let yaw = 0, pitch = -0.08, pos = { x: 0, z: 0 }, alvo = null, passo = 0;
  let precisa = true;
  const cache = new Map();
  const segurando = { frente: 0, giro: 0 };

  const anunciar = (t) => { if (estado) estado.textContent = t; };

  // Profundidade lida de um PNG de 8 bits para um Float32Array em metros.
  function carregarMapa(src) {
    return new Promise((ok, erro) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        const d = new Float32Array(c.width * c.height);
        const k = Math.log(DMAX / DMIN) / 255;
        for (let i = 0; i < d.length; i++) d[i] = DMIN * Math.exp(px[i * 4] * k);
        ok({ d, w: c.width, h: c.height });
      };
      img.onerror = erro;
      img.src = src;
    });
  }

  function carregarTextura(src) {
    return new Promise((ok, erro) => {
      new THREE.TextureLoader().load(src, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        ok(t);
      }, undefined, erro);
    });
  }

  function buscar(id) {
    if (!cache.has(id)) {
      const no = dados.nos[id];
      cache.set(id, Promise.all([
        carregarTextura(new URL(no.img, base).href),
        carregarMapa(new URL(no.dist, base).href),
      ]));
    }
    return cache.get(id);
  }

  // Amostra o mapa na coordenada de textura (u, v), com v = 0 no topo.
  function amostra(m, u, v) {
    const x = ((Math.floor(u * m.w) % m.w) + m.w) % m.w;
    const y = Math.min(m.h - 1, Math.max(0, Math.floor(v * m.h)));
    return m.d[y * m.w + x];
  }

  // Esfera deformada pela distancia. O scale(-1, 1, 1) vira a esfera do
  // avesso, como no tour do apart hotel: sem ele o panorama sai espelhado.
  // Depois dele, a coluna u da foto fica na direcao (cos 2πu, 0, sin 2πu).
  function montarMalha(textura, mapa) {
    const geo = new THREE.SphereGeometry(1, 256, 128);
    geo.scale(-1, 1, 1);
    const p = geo.attributes.position, uv = geo.attributes.uv, v3 = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i).normalize();
      const d = amostra(mapa, uv.getX(i), 1 - uv.getY(i));
      p.setXYZ(i, v3.x * d, v3.y * d, v3.z * d);
    }
    p.needsUpdate = true;
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: textura }));
  }

  // Ate onde da para andar em cada direcao: a menor distancia horizontal de
  // algo acima do piso (mesa, parede, brinquedo), em 120 setores.
  function medirAnel(mapa) {
    const n = 120, r = new Float32Array(n).fill(DMAX);
    for (let y = 0; y < mapa.h; y += 2) {
      const lat = (0.5 - (y + 0.5) / mapa.h) * Math.PI;
      if (lat < -0.75 || lat > 0.35) continue;
      for (let x = 0; x < mapa.w; x += 2) {
        const d = mapa.d[y * mapa.w + x];
        if (d * Math.sin(lat) < -ALTURA + 0.25) continue;   // e chao
        const s = Math.floor((x / mapa.w) * n);
        r[s] = Math.min(r[s], d * Math.cos(lat));
      }
    }
    return r;
  }

  // Colisao: raio horizontal contra a malha, na altura da cintura e do olho,
  // a partir de onde a camera esta. O anel acima so ve a partir do centro;
  // de um ponto deslocado, a parede pode estar mais perto do que ele diz.
  let rc = null;
  const cintura = -0.7;
  function livre(de, para) {
    const dx = para.x - de.x, dz = para.z - de.z, passo = Math.hypot(dx, dz);
    if (passo < 1e-5) return para;
    rc = rc || new THREE.Raycaster();
    const dir = new THREE.Vector3(dx / passo, 0, dz / passo);
    let max = Infinity;
    for (const y of [-ALTURA + 0.3, cintura, 0]) {
      rc.set(new THREE.Vector3(de.x, y, de.z), dir);
      rc.far = passo + FOLGA + 0.5;
      const h = rc.intersectObject(malha, false);
      if (h.length) max = Math.min(max, h[0].distance - FOLGA);
    }
    if (max >= passo) return para;
    const k = Math.max(0, max) / passo;
    return { x: de.x + dx * k, z: de.z + dz * k };
  }

  function limitar(x, z) {
    const lim = atual.andar;
    let dist = Math.hypot(x, z);
    if (dist < 1e-4) return { x, z };
    let ang = Math.atan2(z, x);
    if (ang < 0) ang += Math.PI * 2;
    const s = Math.floor((ang / (Math.PI * 2)) * anel.length) % anel.length;
    const max = Math.max(0, Math.min(lim, anel[s] - FOLGA));
    if (dist <= max) return { x, z };
    return { x: (x / dist) * max, z: (z / dist) * max };
  }

  function direcao() {
    return new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
  }

  function posicionarCamera() {
    const bob = reduzido ? 0 : Math.sin(passo) * 0.025;
    camera.position.set(pos.x, bob, pos.z);
    camera.lookAt(camera.position.clone().add(direcao()));
    // project() das portas usa a matriz inversa, que o three so refaz no
    // render; sem isto as portas saem na posicao do quadro anterior.
    camera.updateMatrixWorld();
  }

  // Portas: botoes HTML de verdade, focaveis, levados para cima do canvas
  // na posicao projetada do vao.
  let portas = [];
  function montarPortas(no, mapa) {
    camadaPortas.textContent = '';
    portas = no.links.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = l.passo ? 'tour__porta tour__porta--passo' : 'tour__porta';
      b.dataset.para = l.para;
      b.innerHTML = '<span class="tour__seta" aria-hidden="true"></span><span class="tour__rotulo"></span>';
      b.querySelector('.tour__rotulo').textContent = l.rotulo;
      b.addEventListener('click', () => (l.passo ? passar(l.para) : irPara(l.para, l)));
      camadaPortas.appendChild(b);
      // Ponto do mesmo salao: o marcador fica no chao, onde se vai pisar.
      if (l.passo) {
        const d = desloc(no, dados.nos[l.para]);
        return { b, link: l, ponto: new THREE.Vector3(d.x, -ALTURA + 0.35, d.z) };
      }
      // A porta fica na parede, nao no primeiro objeto: a distancia vem da
      // faixa logo acima do horizonte, acima de mesa e cadeira.
      const ang = l.u * Math.PI * 2;
      const r = Math.max(2, Math.min(amostra(mapa, l.u, 0.44) * 0.95, 12));
      return { b, link: l, ponto: new THREE.Vector3(Math.cos(ang) * r, -0.35, Math.sin(ang) * r) };
    });
  }

  // Porta fora do quadro fica presa na borda, do lado para onde girar, para
  // ninguem chegar num espaco sem saber para onde ir. As presas se empilham.
  function atualizarPortas() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const presas = { e: 0, d: 0 };
    for (const p of portas) {
      const v = p.ponto.clone().project(camera);
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const dentro = v.z < 1 && x > 60 && x < w - 60 && y > 40 && y < h - 40;
      let lado = '';
      if (!dentro) {
        let dif = Math.atan2(p.ponto.z - pos.z, p.ponto.x - pos.x) - yaw;
        dif = Math.atan2(Math.sin(dif), Math.cos(dif));
        lado = dif > 0 ? 'd' : 'e';
        y = h * 0.42 + presas[lado]++ * 56;
        p.b.style.left = lado === 'e' ? '0.75rem' : 'auto';
        p.b.style.right = lado === 'd' ? '0.75rem' : 'auto';
        p.b.style.transform = `translateY(${y}px) translateY(-50%)`;
      } else {
        p.b.style.left = '0';
        p.b.style.right = 'auto';
        p.b.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
      p.b.dataset.lado = lado;
    }
  }

  async function mostrar(id, chegada) {
    const no = dados.nos[id];
    const [textura, mapa] = await buscar(id);
    if (malha) { cena.remove(malha); malha.geometry.dispose(); malha.material.dispose(); }
    malha = montarMalha(textura, mapa);
    cena.add(malha);
    yaw = ((chegada != null ? chegada : no.olhar) * Math.PI * 2);
    pitch = -0.08;
    assumir(id, mapa);
  }

  // Estado comum a chegar por porta e a chegar andando.
  function assumir(id, mapa) {
    const no = dados.nos[id];
    atual = no; atual.id = id;
    anel = medirAnel(mapa);
    pos = { x: 0, z: 0 }; alvo = null;
    montarPortas(no, mapa);
    if (titulo) titulo.textContent = no.nome;
    raiz.querySelectorAll('[data-tour-ir]').forEach((b) => b.setAttribute('aria-current', b.dataset.tourIr === id.replace(/-\d+$/, '') ? 'true' : 'false'));
    anunciar(`Você está em: ${no.nome}. ${no.dica || ''}`);
    precisa = true;
    // Vizinhos ja vem baixando, para a troca de espaco ser imediata.
    no.links.forEach((l) => buscar(l.para).catch(() => {}));
  }

  function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function animar(ms, passo) {
    return new Promise((ok) => {
      if (!ms) { passo(1); ok(); return; }
      const t0 = performance.now();
      const tique = (agora) => {
        const k = Math.min(1, (agora - t0) / ms);
        passo(k);
        if (k < 1) requestAnimationFrame(tique); else ok();
      };
      requestAnimationFrame(tique);
    });
  }

  // Deslocamento, em metros, entre dois pontos do mesmo espaco.
  function desloc(a, b) {
    const pa = a.pos || [0, 0], pb = b.pos || [0, 0];
    return { x: pb[0] - pa[0], z: pb[1] - pa[1] };
  }

  // Andar ate outro ponto do mesmo salao. Os dois panoramas sao do mesmo
  // lugar (o segundo nasceu da reprojecao do primeiro), entao a malha nova
  // entra no lugar certo do mundo e se funde com a atual enquanto a camera
  // caminha ate o centro dela. Sem veu: e uma caminhada, nao um corte.
  async function passar(id) {
    if (ocupado || !dados.nos[id]) return;
    ocupado = true;
    alvo = null;
    const no = dados.nos[id];
    const d = desloc(atual, no);
    let textura, mapa;
    try {
      [textura, mapa] = await buscar(id);
    } catch (e) {
      aviso.hidden = false;
      ocupado = false;
      return;
    }
    const nova = montarMalha(textura, mapa);
    nova.position.set(d.x, 0, d.z);
    nova.material.transparent = true;
    nova.material.opacity = 0;
    cenaB.add(nova);
    transicao = nova;
    const p0 = { x: pos.x, z: pos.z }, yaw0 = yaw;
    const ang = Math.atan2(d.z - p0.z, d.x - p0.x);
    const giro = Math.atan2(Math.sin(ang - yaw0), Math.cos(ang - yaw0));
    const ms = reduzido ? 0 : Math.min(2200, 650 + Math.hypot(d.x - p0.x, d.z - p0.z) * 380);
    await animar(ms, (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      yaw = yaw0 + giro * Math.min(1, k * 3);
      pos = { x: p0.x + (d.x - p0.x) * e, z: p0.z + (d.z - p0.z) * e };
      // Fusao curta, no meio do trajeto: cada malha so aparece perto do
      // proprio centro, onde ainda nao estica.
      nova.material.opacity = Math.min(1, Math.max(0, (k - 0.38) / 0.24));
      passo += 0.16;
      precisa = true;
    });
    cenaB.remove(nova);
    cena.remove(malha); malha.geometry.dispose(); malha.material.dispose();
    nova.position.set(0, 0, 0);
    nova.material.transparent = false;
    nova.material.opacity = 1;
    malha = nova;
    cena.add(malha);
    transicao = null;
    assumir(id, mapa);
    ocupado = false;
  }

  // Ponto do mesmo salao mais alinhado com uma direcao, dentro da tolerancia.
  function passoNaDirecao(ang, tolerancia) {
    let melhor = null, menor = tolerancia;
    for (const l of atual.links) {
      if (!l.passo) continue;
      const d = desloc(atual, dados.nos[l.para]);
      const a = Math.atan2(d.z - pos.z, d.x - pos.x);
      const dif = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
      if (dif < menor) { menor = dif; melhor = l.para; }
    }
    return melhor;
  }

  async function irPara(id, link) {
    if (ocupado || !dados.nos[id]) return;
    ocupado = true;
    if (link && !reduzido) {
      // Caminha ate a porta antes de trocar: e isso que faz parecer andar.
      const ang = link.u * Math.PI * 2;
      yaw = ang;
      const destino = limitar(Math.cos(ang) * 6, Math.sin(ang) * 6);
      alvo = destino;
      await esperar(520);
      veu.classList.add('is-on');
      await esperar(260);
    } else {
      veu.classList.add('is-on');
      await esperar(reduzido ? 0 : 200);
    }
    try {
      await mostrar(id, link ? link.chegada : null);
    } catch (e) {
      aviso.hidden = false;
    }
    veu.classList.remove('is-on');
    ocupado = false;
  }

  // Entrada: arrastar gira, clique sem arraste anda ate o ponto.
  const ray = () => new THREE.Raycaster();
  let arraste = null;
  function pontoNoChao(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const rc = ray();
    rc.setFromCamera(ndc, camera);
    const d = rc.ray.direction;
    if (d.y < -0.05) {
      // Interseccao com o plano do piso, mais barata e estavel que a malha.
      const t = (-ALTURA - camera.position.y) / d.y;
      return { x: camera.position.x + d.x * t, z: camera.position.z + d.z * t, chao: true };
    }
    const hits = rc.intersectObject(malha);
    if (hits.length) return { x: hits[0].point.x, z: hits[0].point.z, chao: false };
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    arraste = { x: e.clientX, y: e.clientY, yaw, pitch, moveu: false, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (arraste && arraste.id === e.pointerId) {
      const dx = e.clientX - arraste.x, dy = e.clientY - arraste.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) arraste.moveu = true;
      if (arraste.moveu) {
        const k = (camera.fov * Math.PI / 180) / canvas.clientHeight;
        yaw = arraste.yaw - dx * k;
        pitch = Math.max(-1.3, Math.min(1.3, arraste.pitch + dy * k));
        precisa = true;
      }
    } else if (e.pointerType === 'mouse' && malha) {
      const p = pontoNoChao(e.clientX, e.clientY);
      cursor.visible = !!(p && p.chao);
      if (p && p.chao) {
        const l = limitar(p.x, p.z);
        cursor.position.set(l.x, -ALTURA + 0.02, l.z);
      }
      precisa = true;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!arraste) return;
    const clique = !arraste.moveu;
    arraste = null;
    if (!clique || ocupado || !malha) return;
    const p = pontoNoChao(e.clientX, e.clientY);
    if (p) {
      // Clique alem de onde este ponto aguenta, na direcao de outro ponto do
      // salao, continua a caminhada por ele.
      const lim = limitar(p.x, p.z);
      if (Math.hypot(p.x - lim.x, p.z - lim.z) > 0.4) {
        const prox = passoNaDirecao(Math.atan2(p.z - pos.z, p.x - pos.x), 0.45);
        if (prox) { passar(prox); return; }
      }
      // Clique na parede anda na direcao dela, ate o limite.
      alvo = limitar(p.chao ? p.x : p.x * 0.9, p.chao ? p.z : p.z * 0.9);
    }
  });
  canvas.addEventListener('pointerleave', () => { if (cursor) { cursor.visible = false; precisa = true; } });

  const teclas = new Set();
  palco.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
      teclas.add(k);
    }
  });
  palco.addEventListener('keyup', (e) => teclas.delete(e.key.toLowerCase()));
  palco.addEventListener('blur', () => teclas.clear(), true);

  // Botoes de andar e girar: segurar mantem o movimento.
  raiz.querySelectorAll('[data-tour-mov]').forEach((b) => {
    const [tipo, valor] = b.dataset.tourMov.split(':');
    const ligar = (e) => { e.preventDefault(); segurando[tipo] = Number(valor); };
    const desligar = () => { segurando[tipo] = 0; };
    b.addEventListener('pointerdown', ligar);
    b.addEventListener('pointerup', desligar);
    b.addEventListener('pointerleave', desligar);
    b.addEventListener('pointercancel', desligar);
    b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') ligar(e); });
    b.addEventListener('keyup', desligar);
    b.addEventListener('blur', desligar);
  });

  raiz.querySelectorAll('[data-tour-ir]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!ativo) { comecar(b.dataset.tourIr); return; }
      irPara(b.dataset.tourIr, null);
      palco.scrollIntoView({ behavior: reduzido ? 'auto' : 'smooth', block: 'center' });
    });
  });

  const telaCheia = raiz.querySelector('[data-tour-tela]');
  if (telaCheia) {
    if (!palco.requestFullscreen) telaCheia.hidden = true;
    telaCheia.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else palco.requestFullscreen().catch(() => {});
    });
  }

  let ultimo = performance.now();
  function quadro(agora) {
    requestAnimationFrame(quadro);
    const dt = Math.min(0.05, (agora - ultimo) / 1000);
    ultimo = agora;
    if (!ativo || !malha || document.hidden) return;

    let andando = false;
    const frente = segurando.frente + (teclas.has('arrowup') || teclas.has('w') ? 1 : 0) - (teclas.has('arrowdown') || teclas.has('s') ? 1 : 0);
    const giro = segurando.giro + (teclas.has('arrowright') || teclas.has('d') ? 1 : 0) - (teclas.has('arrowleft') || teclas.has('a') ? 1 : 0);
    if (giro) { yaw += giro * dt * 1.4; precisa = true; }
    if (frente && !ocupado) {
      alvo = null;
      const v = 1.6 * dt * frente;
      const n = livre(pos, limitar(pos.x + Math.cos(yaw) * v, pos.z + Math.sin(yaw) * v));
      andando = Math.hypot(n.x - pos.x, n.z - pos.z) > 1e-4;
      pos = n;
      // Chegou ao limite andando para frente: segue para o proximo ponto do
      // salao, se houver um a frente.
      if (!andando && frente > 0) {
        const prox = passoNaDirecao(yaw, 0.6);
        if (prox) passar(prox);
      }
    }
    if (alvo) {
      const dx = alvo.x - pos.x, dz = alvo.z - pos.z, dist = Math.hypot(dx, dz);
      if (dist < 0.02) alvo = null;
      else {
        const v = Math.min(dist, Math.max(0.6, dist * 3) * dt);
        const n = livre(pos, { x: pos.x + (dx / dist) * v, z: pos.z + (dz / dist) * v });
        if (Math.hypot(n.x - pos.x, n.z - pos.z) < 1e-4) alvo = null;
        pos = n;
        andando = true;
      }
    }
    if (andando) { passo += dt * 9; precisa = true; }
    if (!precisa) return;
    posicionarCamera();
    atualizarPortas();
    if (transicao) {
      renderer.autoClear = false;
      renderer.clear();
      renderer.render(cena, camera);
      renderer.clearDepth();
      renderer.render(cenaB, camera);
      renderer.autoClear = true;
    } else {
      renderer.render(cena, camera);
    }
    precisa = false;
  }

  function redimensionar() {
    if (!renderer) return;
    const w = palco.clientWidth, h = palco.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 82 : 70;
    camera.updateProjectionMatrix();
    precisa = true;
  }

  async function comecar(primeiro) {
    if (ativo) return;
    entrar.disabled = true;
    entrar.textContent = 'Abrindo o quarto...';
    try {
      THREE = await import('./vendor/three.module.js');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      aviso.hidden = false;
      entrar.disabled = false;
      entrar.textContent = 'Tentar de novo';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    cena = new THREE.Scene();
    cenaB = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    cursor.visible = false;
    cursor.renderOrder = 2;
    cena.add(cursor);
    redimensionar();
    new ResizeObserver(redimensionar).observe(palco);
    try {
      await mostrar(primeiro || dados.inicio);
    } catch (e) {
      aviso.hidden = false;
      entrar.disabled = false;
      entrar.textContent = 'Tentar de novo';
      return;
    }
    ativo = true;
    raiz.setAttribute('data-ativo', '');
    palco.focus({ preventScroll: true });
    requestAnimationFrame(quadro);
  }

  // tour.html#brinquedao abre direto naquele espaco (links da pagina Espacos).
  const doHash = location.hash.slice(1);
  if (dados.nos[doHash]) dados.inicio = doHash;
  entrar.addEventListener('click', () => comecar());
}
