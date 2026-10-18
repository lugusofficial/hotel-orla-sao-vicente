// Menu, cabecalho sobre o video, video do heroi, reveal, depoimentos, barra de
// WhatsApp, formulario de contato e barra de reserva. Progressivo: sem este arquivo a pagina
// continua inteira e legivel.
(function () {
  'use strict';
  var reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var header = document.querySelector('.site-header');

  /* Menu */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  function abrir(sim) {
    if (!toggle || !nav) { return; }
    nav.setAttribute('data-open', sim ? 'true' : 'false');
    toggle.setAttribute('aria-expanded', sim ? 'true' : 'false');
    toggle.querySelector('.icon--menu').hidden = sim;
    toggle.querySelector('.icon--close').hidden = !sim;
    if (header) { header.classList.toggle('is-aberto', sim); }
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () { abrir(nav.getAttribute('data-open') !== 'true'); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) { abrir(false); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { abrir(false); } });
  }

  /* Cabecalho transparente enquanto ha video atras dele. O limite e medido
     fora do evento de rolagem, para nao forcar layout a cada quadro. */
  var cena = document.querySelector('.cena');
  if (header && cena) {
    var limite = 0;
    var medir = function () {
      var h = Math.round(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--altura-header', h + 'px');
      limite = cena.getBoundingClientRect().bottom + window.scrollY - h;
    };
    var avaliar = function () { header.classList.toggle('is-sobre', window.scrollY < limite - 10); };
    medir(); avaliar();
    window.addEventListener('scroll', avaliar, { passive: true });
    window.addEventListener('resize', function () { medir(); avaliar(); });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { medir(); avaliar(); }); }
  }

  /* Video do heroi: mudo, em loop, sempre tocando, sem botao. Pausa
     fora da tela. Se a economia de bateria do iPhone recusar o play, troca
     pela mesma cena em webp animado, baixado so nesse caso. */
  var video = document.querySelector('[data-video-el]');
  if (video) {
    var trocado = false;
    var trocar = function () {
      var src = video.getAttribute('data-fallback');
      if (trocado || !src) { return; }
      trocado = true;
      var img = document.createElement('img');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.src = src;
      video.pause();
      video.replaceWith(img);
    };
    var tocar = function () {
      if (trocado) { return; }
      var p = video.play();
      if (p) { p.catch(function (e) { if (e && e.name === 'NotAllowedError') { trocar(); } }); }
    };
    tocar();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (!en.isIntersecting) { if (!video.paused) { video.pause(); } } else if (video.paused) { tocar(); }
        });
      }, { threshold: 0.15 }).observe(video);
    }
  }

  /* Reveal ao rolar, com entrada escalonada nas listas. Depois que a entrada
     acaba, o atributo sai, para o hover dos cartoes voltar a mandar. */
  if (!reduzido && 'IntersectionObserver' in window) {
    var alvos = [].slice.call(document.querySelectorAll('main .section > .container, .topo .container, [data-reveal-filhos]'));
    document.documentElement.classList.add('js-reveal');
    alvos.forEach(function (t) { if (!t.hasAttribute('data-reveal-filhos')) { t.setAttribute('data-reveal', ''); } });
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        var el = en.target;
        el.classList.add('is-visible');
        obs.unobserve(el);
        if (el.hasAttribute('data-reveal-filhos')) {
          setTimeout(function () { el.removeAttribute('data-reveal-filhos'); }, 1400);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    alvos.forEach(function (t) { obs.observe(t); });
  }

  /* Depoimentos: um por vez, troca sozinho a cada 6 s ate a primeira
     interacao. Sem script todos aparecem empilhados. */
  var depo = document.querySelector('[data-depo]');
  if (depo) {
    var itens = [].slice.call(depo.querySelectorAll('.depo__item'));
    var pontos = depo.querySelector('.depo__nav');
    if (itens.length > 1 && pontos) {
      var atual = 0, parado = reduzido;
      var botoes = itens.map(function (item, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'depo__ponto';
        b.setAttribute('aria-label', 'Depoimento ' + (i + 1) + ' de ' + itens.length);
        b.addEventListener('click', function () { parado = true; ir(i); });
        pontos.appendChild(b);
        return b;
      });
      var ir = function (i) {
        atual = (i + itens.length) % itens.length;
        itens.forEach(function (it, k) { it.classList.toggle('is-atual', k === atual); it.setAttribute('aria-hidden', k === atual ? 'false' : 'true'); });
        botoes.forEach(function (b, k) { b.setAttribute('aria-current', k === atual ? 'true' : 'false'); });
      };
      depo.classList.add('is-live');
      ir(0);
      setInterval(function () { if (!parado && !document.hidden) { ir(atual + 1); } }, 6000);
    } else {
      itens.forEach(function (it) { it.classList.add('is-atual'); });
    }
  }

  /* Barra de WhatsApp no celular: aparece depois da primeira dobra. */
  var barra = document.querySelector('.barra-wa');
  if (barra) {
    var mostrar = function () { barra.classList.toggle('is-on', window.scrollY > window.innerHeight * 0.6); };
    mostrar();
    window.addEventListener('scroll', mostrar, { passive: true });
  }

  /* Orcamento: monta a mensagem e abre o WhatsApp. */
  var form = document.querySelector('form[data-orcamento]');
  if (form) {
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var invalido = form.querySelector(':invalid');
      if (invalido) {
        if (status) { status.textContent = 'Falta preencher: ' + (invalido.labels && invalido.labels[0] ? invalido.labels[0].textContent : 'um campo'); }
        invalido.focus();
        return;
      }
      // Cada campo entra com o texto do proprio rotulo, entao o mesmo codigo
      // serve a qualquer formulario de pedido do site.
      var linhas = [form.getAttribute('data-msg') || 'Olá! Quero fazer uma reserva.'];
      [].slice.call(form.querySelectorAll('input[name], select[name], textarea[name]')).forEach(function (el) {
        var v = String(el.value || '').trim();
        var rotulo = el.labels && el.labels[0] ? el.labels[0].textContent.trim() : el.name;
        if (v) { linhas.push(rotulo + ': ' + v); }
      });
      var url = form.getAttribute('action') + '?text=' + encodeURIComponent(linhas.join('\n'));
      if (status) { status.textContent = 'Abrindo o WhatsApp com a sua mensagem.'; }
      window.open(url, '_blank', 'noopener');
    });
  }

  /* Barra de reserva: datas e hospedes viram uma mensagem pronta no WhatsApp
     da recepcao (o numero e de demonstracao, vem do action do formulario).
     Sem script, o formulario leva a pagina de contato. */
  var reserva = document.querySelector('form[data-reserva]');
  if (reserva) {
    var ent = reserva.querySelector('[name="entrada"]');
    var sai = reserva.querySelector('[name="saida"]');
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var hoje = new Date();
    var amanha = new Date(hoje.getTime() + 864e5);
    ent.min = iso(hoje);
    if (!ent.value) { ent.value = iso(hoje); }
    if (!sai.value) { sai.value = iso(amanha); }
    var ajustarSaida = function () {
      var min = new Date(new Date(ent.value).getTime() + 864e5);
      sai.min = iso(min);
      if (!sai.value || sai.value <= ent.value) { sai.value = iso(min); }
    };
    ajustarSaida();
    ent.addEventListener('change', ajustarSaida);
    var br = function (v) { var p = v.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
    var aviso = reserva.querySelector('.form-status');
    reserva.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!reserva.reportValidity()) { return; }
      var adultos = reserva.querySelector('[name="adultos"]');
      var criancas = reserva.querySelector('[name="criancas"]');
      var linhas = ['Olá! Quero reservar.'];
      if (reserva.getAttribute('data-quarto')) { linhas.push('Quarto: ' + reserva.getAttribute('data-quarto')); }
      linhas.push('Entrada: ' + br(ent.value), 'Saída: ' + br(sai.value),
        'Hóspedes: ' + adultos.options[adultos.selectedIndex].text + (criancas.value !== '0' ? ', ' + criancas.options[criancas.selectedIndex].text : ''));
      var url = reserva.getAttribute('data-whatsapp') + '?text=' + encodeURIComponent(linhas.join('\n'));
      if (aviso) { aviso.textContent = 'Abrindo o WhatsApp com as suas datas.'; }
      window.open(url, '_blank', 'noopener');
    });
  }

  var ano = document.querySelector('[data-year]');
  if (ano) { ano.textContent = String(new Date().getFullYear()); }
})();
