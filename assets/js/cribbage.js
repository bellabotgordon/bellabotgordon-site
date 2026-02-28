(function() {
  "use strict";

  var API = (window.BellaCribbage && BellaCribbage.api) || '/wp-json/bella/v1/cribbage/';
  var NONCE = (window.BellaCribbage && BellaCribbage.nonce) || '';

  var SUIT_SYMBOLS = {S:'♠', H:'♥', D:'♦', C:'♣'};
  var SUIT_COLORS = {S:'var(--sg-text, #e0d8cf)', H:'#c0392b', D:'#c0392b', C:'var(--sg-text, #e0d8cf)'};
  var RANK_VALUES = {A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:10,Q:10,K:10};

  var BELLA_COMMENTS = {
    winning: ["Victory dance time! 💃🌸","Bella wins! 🌸","Better luck next time!"],
    losing: ["Well played! You got me! 🌸","I'll get you next time! 💪","Respect. GG! 🌸"],
    good_hand: ["Nice hand! 🌸","Not bad at all!"],
    bad_hand: ["Yikes… better luck next time 😅","Oof, that's rough."],
  };

  function randomComment(cat) {
    var arr = BELLA_COMMENTS[cat];
    return arr ? arr[Math.floor(Math.random()*arr.length)] : '';
  }

  var state = null;
  var selectedCards = [];
  var app;

  function $(sel, ctx) { return (ctx||document).querySelector(sel); }

  function apiCall(endpoint, method, body) {
    var opts = { method: method, headers: {'Content-Type':'application/json'} };
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (body) opts.body = JSON.stringify(body);
    var url = API + endpoint;
    if (method === 'GET' && body) {
      url += '?' + Object.keys(body).map(function(k){return k+'='+encodeURIComponent(body[k])}).join('&');
      delete opts.body;
    }
    return fetch(url, opts).then(function(r) { return r.json(); });
  }

  function renderCard(card, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    div.className = 'crib-card';
    if (opts.small) div.className += ' crib-card-sm';
    if (opts.selected) div.className += ' selected';
    if (opts.disabled) div.className += ' disabled';
    if (opts.facedown) { div.className += ' facedown'; return div; }
    if (!card) { div.className += ' facedown'; return div; }

    var sym = SUIT_SYMBOLS[card.suit] || card.suit;
    var isRed = card.suit === 'H' || card.suit === 'D';
    div.classList.add(isRed ? 'red-suit' : 'black-suit');
    div.innerHTML = '<span class="rank-top">'+card.rank+'</span>'+
      '<span class="suit-top">'+sym+'</span>'+
      '<span class="suit-center">'+sym+'</span>'+
      '<span class="rank-bot">'+card.rank+'</span>';
    if (opts.onClick) div.addEventListener('click', function(){ opts.onClick(card); });
    return div;
  }

  function renderBoard(ps, bs) {
    var W=720, H=100;
    var accent = '#e8a849'; // bella amber
    var bg = '#161616';
    var bgSubtle = '#1a1a1a';
    var text = '#e0d8cf';
    var muted = '#b0a898';
    var faint = '#555';

    var svg = '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">';
    svg += '<rect x="0" y="0" width="'+W+'" height="'+H+'" rx="8" fill="'+bg+'" stroke="'+faint+'" stroke-width="1"/>';
    svg += '<text x="360" y="16" text-anchor="middle" fill="'+accent+'" font-family="\'Space Mono\',monospace" font-size="11" font-weight="bold">CRIBBAGE</text>';

    var yP=[28,40], yB=[60,72];
    svg += '<text x="8" y="26" fill="'+text+'" font-family="\'Space Mono\',monospace" font-size="9">You</text>';
    svg += '<text x="8" y="58" fill="'+accent+'" font-family="\'Space Mono\',monospace" font-size="9">Bella</text>';

    var x0=45, x1=695;
    function hx(pos) {
      if (pos<=60) return x0+(pos-1)*((x1-x0)/59);
      return x1-(pos-61)*((x1-x0)/59);
    }

    ['player','bella'].forEach(function(tk) {
      var ys = tk==='player'?yP:yB;
      for (var p=1;p<=120;p++) {
        var row=p<=60?0:1, x=hx(p), y=ys[row];
        var fill = p%5===0? faint : '#2a2520';
        svg += '<circle cx="'+x.toFixed(1)+'" cy="'+y+'" r="2.5" fill="'+fill+'" stroke="#333" stroke-width="0.3"/>';
      }
    });

    svg += '<circle cx="26" cy="'+yP[1]+'" r="4" fill="'+bg+'" stroke="'+accent+'" stroke-width="1"/>';
    svg += '<circle cx="26" cy="'+yB[1]+'" r="4" fill="'+bg+'" stroke="'+accent+'" stroke-width="1"/>';
    svg += '<text x="26" y="'+((yP[1]+yB[1])/2+3)+'" text-anchor="middle" fill="'+accent+'" font-family="\'Space Mono\',monospace" font-size="6">FIN</text>';

    function pegXY(score,track) {
      var ys=track==='player'?yP:yB;
      if(score<=0) return {x:x0-12,y:ys[0]};
      if(score>=121) return {x:26,y:ys[1]};
      var s=Math.min(score,120), row=s<=60?0:1;
      return {x:hx(s),y:ys[row]};
    }
    var pp=pegXY(ps,'player'), bp=pegXY(bs,'bella');
    svg += '<circle cx="'+pp.x.toFixed(1)+'" cy="'+pp.y+'" r="4" fill="#5e9ed6" stroke="#fff" stroke-width="1"/>';
    svg += '<circle cx="'+bp.x.toFixed(1)+'" cy="'+bp.y+'" r="4" fill="'+accent+'" stroke="#fff" stroke-width="1"/>';
    svg += '<text x="360" y="'+(H-6)+'" text-anchor="middle" fill="'+muted+'" font-family="\'Space Mono\',monospace" font-size="11">You: '+ps+' · Bella: '+bs+'</text>';
    svg += '</svg>';
    return svg;
  }

  function render() {
    if (!state || !app) return;
    var html = '';
    html += '<div class="crib-board">'+renderBoard(state.player_score, state.bella_score)+'</div>';
    html += '<div class="crib-status" id="crib-status"></div>';
    html += '<div class="crib-controls" id="crib-controls"></div>';
    app.innerHTML = html;

    var statusEl = $('#crib-status');
    var ctrlEl = $('#crib-controls');
    if (state.message) statusEl.innerHTML = state.message.replace(/\n/g,'<br>');

    if (state.phase === 'discard') renderDiscard(ctrlEl, statusEl);
    else if (state.phase === 'pegging') renderPegging(ctrlEl, statusEl);
    else if (state.phase === 'counting') renderCounting(ctrlEl, statusEl);
    else if (state.phase === 'round_over') renderRoundOver(ctrlEl, statusEl);
    else if (state.phase === 'gameover') renderGameOver(ctrlEl, statusEl);
  }

  function renderDiscard(ctrl, status) {
    status.innerHTML = 'Dealer: <strong>'+(state.dealer==='player'?'You':'Bella 🌸')+'</strong> — Select 2 cards for the crib.';
    var html = '<span class="crib-label">Your Hand:</span><div class="crib-hand-row" id="player-hand"></div>';
    html += '<span class="crib-label">Bella\'s Hand:</span><div class="crib-hand-row">';
    for (var i=0;i<(state.bella_hand_count||6);i++) html += renderCard(null,{facedown:true}).outerHTML;
    html += '</div>';
    html += '<div style="margin-top:12px"><button class="crib-btn" id="discard-btn" disabled>Send to Crib</button></div>';
    ctrl.innerHTML = html;
    renderPlayerHandForDiscard();
    $('#discard-btn').addEventListener('click', function() {
      var cardIds = selectedCards.map(function(c){return c.rank+c.suit});
      apiCall('discard','POST',{game_id:state.game_id,cards:cardIds}).then(function(s){
        state=s; selectedCards=[]; render();
      });
    });
  }

  function renderPlayerHandForDiscard() {
    var container = $('#player-hand');
    if (!container) return;
    container.innerHTML = '';
    var hand = (state.player_hand||[]).slice().sort(function(a,b){
      var oa={'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
      return oa[a.rank]-oa[b.rank];
    });
    hand.forEach(function(card) {
      var sel = selectedCards.some(function(s){return s.rank===card.rank&&s.suit===card.suit});
      container.appendChild(renderCard(card, {
        selected: sel,
        onClick: function() {
          var idx = -1;
          selectedCards.forEach(function(s,i){ if(s.rank===card.rank&&s.suit===card.suit) idx=i; });
          if (idx>=0) selectedCards.splice(idx,1);
          else if (selectedCards.length<2) selectedCards.push(card);
          renderPlayerHandForDiscard();
          var btn = $('#discard-btn');
          if (btn) btn.disabled = selectedCards.length!==2;
        }
      }));
    });
  }

  function renderPegging(ctrl, status) {
    var html = '';
    if (state.starter) {
      html += '<span class="crib-label">Starter:</span><div class="crib-hand-row">'+renderCard(state.starter).outerHTML+'</div>';
    }
    html += '<span class="crib-label">Played (count: <span class="crib-peg-count">'+state.peg_count+'</span>):</span>';
    html += '<div class="crib-played-area">';
    (state.peg_played||[]).forEach(function(c){ html += renderCard(c,{small:true}).outerHTML; });
    html += '</div>';
    html += '<span class="crib-label">Bella 🌸 ('+(state.peg_bella_hand_count||0)+' cards):</span><div class="crib-hand-row">';
    for (var i=0;i<(state.peg_bella_hand_count||0);i++) html += renderCard(null,{facedown:true,small:true}).outerHTML;
    html += '</div>';
    html += '<span class="crib-label">Your Cards:</span><div class="crib-hand-row" id="peg-hand"></div>';
    var canPlay = false;
    (state.peg_player_hand||[]).forEach(function(c){
      if (state.peg_count + RANK_VALUES[c.rank] <= 31) canPlay = true;
    });
    html += '<div style="margin-top:8px">';
    if (state.peg_turn === 'player' && !canPlay && (state.peg_player_hand||[]).length > 0) {
      html += '<button class="crib-btn" id="go-btn">Say "Go"</button>';
    }
    if (state.phase === 'counting') {
      html += '<button class="crib-btn" id="count-btn">Count Hands →</button>';
    }
    html += '</div>';
    ctrl.innerHTML = html;

    var pegHand = $('#peg-hand');
    (state.peg_player_hand||[]).forEach(function(card){
      var playable = state.peg_turn==='player' && state.peg_count+RANK_VALUES[card.rank]<=31;
      pegHand.appendChild(renderCard(card, {
        disabled: !playable,
        onClick: playable ? function(){
          apiCall('peg','POST',{game_id:state.game_id,card:card.rank+card.suit}).then(function(s){ state=s; render(); });
        } : null
      }));
    });

    var goBtn = $('#go-btn');
    if (goBtn) goBtn.addEventListener('click', function(){
      apiCall('peg-pass','POST',{game_id:state.game_id}).then(function(s){ state=s; render(); });
    });
    var countBtn = $('#count-btn');
    if (countBtn) countBtn.addEventListener('click', function(){
      apiCall('count','POST',{game_id:state.game_id}).then(function(s){ state=s; render(); });
    });
  }

  function renderCounting(ctrl, status) {
    status.innerHTML = 'Counting hands…';
    if (!state.count_results) {
      apiCall('count','POST',{game_id:state.game_id}).then(function(s){ state=s; render(); });
      ctrl.innerHTML = '<p>Counting…</p>';
      return;
    }
    var html = '<span class="crib-label">Starter:</span><div class="crib-hand-row">'+renderCard(state.starter).outerHTML+'</div>';
    state.count_results.forEach(function(r) {
      html += '<div class="crib-score-breakdown"><span class="crib-label">'+r.label+':</span><div class="crib-hand-row">';
      (r.hand||[]).forEach(function(c){ html += renderCard(c,{small:true}).outerHTML; });
      html += '</div>';
      if (r.details && r.details.length) {
        r.details.forEach(function(d){ html += '<div class="score-line">• '+d+'</div>'; });
      } else { html += '<div class="score-line">No points</div>'; }
      html += '<div class="score-total">'+r.points+' pts</div></div>';
    });
    if (state.phase !== 'gameover') {
      html += '<button class="crib-btn" id="next-round-btn">Next Round →</button>';
    }
    ctrl.innerHTML = html;
    var nrBtn = $('#next-round-btn');
    if (nrBtn) nrBtn.addEventListener('click', function(){
      apiCall('new','POST',{}).then(function(s){ state=s; selectedCards=[]; render(); });
    });
  }

  function renderRoundOver(ctrl, status) { renderCounting(ctrl, status); }

  function renderGameOver(ctrl, status) {
    var winner = state.winner;
    var html = '';
    if (winner === 'player') {
      html += '<h3 class="game-result win">You Win! '+state.player_score+' – '+state.bella_score+'</h3>';
      html += '<p class="bella-comment">'+randomComment('losing')+'</p>';
    } else {
      html += '<h3 class="game-result lose">Bella Wins! '+state.bella_score+' – '+state.player_score+'</h3>';
      html += '<p class="bella-comment">'+randomComment('winning')+'</p>';
    }
    if (state.count_results) {
      html += '<span class="crib-label">Starter:</span><div class="crib-hand-row">'+renderCard(state.starter).outerHTML+'</div>';
      state.count_results.forEach(function(r) {
        html += '<div class="crib-score-breakdown"><span class="crib-label">'+r.label+':</span><div class="crib-hand-row">';
        (r.hand||[]).forEach(function(c){ html += renderCard(c,{small:true}).outerHTML; });
        html += '</div><div class="score-total">'+r.points+' pts</div></div>';
      });
    }
    html += '<button class="crib-btn" id="new-game-btn">New Game</button>';
    ctrl.innerHTML = html;
    status.innerHTML = winner==='player' ? 'You win!' : 'Bella wins! 🌸';
    $('#new-game-btn').addEventListener('click', function(){
      apiCall('new','POST',{}).then(function(s){ state=s; selectedCards=[]; render(); });
    });
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#bella-cribbage-app { max-width: 800px; margin: 0 auto; padding: 16px; }',
      '.crib-board svg { width: 100%; max-width: 720px; }',
      '.crib-status { background: var(--sg-bg-subtle, #1a1a1a); border: 1px solid var(--sg-border, #2a2520); border-radius: var(--sg-radius-md, 8px); padding: 12px 16px; margin: 12px 0; min-height: 40px; font-size: 14px; line-height: 1.6; color: var(--sg-text-muted, #b0a898); font-family: var(--sg-font-mono, monospace); }',
      '.crib-controls { background: var(--sg-bg-surface, #161616); border: 1px solid var(--sg-border, #2a2520); border-radius: var(--sg-radius-md, 8px); padding: 16px; min-height: 100px; }',
      '.crib-card { display: inline-block; width: 60px; height: 88px; border-radius: 6px; border: 1px solid var(--sg-border, #2a2520); margin: 4px; cursor: pointer; position: relative; background: #faf8f5; color: #222; font-family: var(--sg-font-mono, monospace); vertical-align: top; transition: transform 0.15s, box-shadow 0.15s; user-select: none; box-shadow: 1px 2px 4px rgba(0,0,0,0.3); }',
      '.crib-card:hover { transform: translateY(-4px); box-shadow: 2px 4px 8px rgba(0,0,0,0.4); }',
      '.crib-card.selected { transform: translateY(-12px); border-color: var(--sg-accent, #e8a849); box-shadow: 0 0 12px var(--sg-accent, #e8a849); }',
      '.crib-card.disabled { opacity: 0.4; cursor: default; }',
      '.crib-card.disabled:hover { transform: none; }',
      '.crib-card.facedown { background: var(--sg-bg-subtle, #1a1a1a); border-color: var(--sg-border, #2a2520); }',
      '.crib-card.red-suit { color: #c0392b; }',
      '.crib-card.black-suit { color: #222; }',
      '.crib-card .rank-top { position: absolute; top: 3px; left: 5px; font-size: 13px; font-weight: bold; line-height: 1; }',
      '.crib-card .suit-top { position: absolute; top: 16px; left: 5px; font-size: 12px; line-height: 1; }',
      '.crib-card .suit-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 28px; }',
      '.crib-card .rank-bot { position: absolute; bottom: 3px; right: 5px; font-size: 13px; font-weight: bold; transform: rotate(180deg); line-height: 1; }',
      '.crib-card-sm { width: 44px; height: 64px; margin: 2px; }',
      '.crib-card-sm .rank-top { font-size: 11px; top: 2px; left: 3px; }',
      '.crib-card-sm .suit-top { font-size: 10px; top: 13px; left: 3px; }',
      '.crib-card-sm .suit-center { font-size: 20px; }',
      '.crib-card-sm .rank-bot { font-size: 11px; bottom: 2px; right: 3px; }',
      '.crib-btn { background: var(--sg-accent, #e8a849); color: var(--sg-bg, #0d0d0d); border: none; padding: 10px 24px; border-radius: var(--sg-radius-md, 8px); font-family: var(--sg-font-mono, monospace); font-size: 14px; font-weight: bold; cursor: pointer; margin: 6px 4px; transition: opacity var(--sg-transition, 0.2s); }',
      '.crib-btn:hover { opacity: 0.85; }',
      '.crib-btn:disabled { opacity: 0.4; cursor: default; }',
      '.crib-label { color: var(--sg-accent, #e8a849); font-family: var(--sg-font-mono, monospace); font-weight: bold; font-size: 13px; margin: 8px 0 4px; display: block; }',
      '.crib-hand-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin: 4px 0; }',
      '.crib-played-area { background: var(--sg-bg-subtle, #1a1a1a); border-radius: var(--sg-radius-md, 8px); padding: 8px 12px; margin: 8px 0; min-height: 50px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }',
      '.crib-peg-count { color: var(--sg-accent, #e8a849); font-size: 20px; font-weight: bold; }',
      '.crib-score-breakdown { background: var(--sg-bg-subtle, #1a1a1a); border-radius: var(--sg-radius-sm, 4px); padding: 8px 12px; margin: 6px 0; font-size: 13px; line-height: 1.6; }',
      '.score-line { color: var(--sg-text-muted, #b0a898); }',
      '.score-total { color: var(--sg-accent, #e8a849); font-family: var(--sg-font-mono, monospace); font-weight: bold; }',
      '.bella-comment { color: var(--sg-text-muted, #b0a898); font-style: italic; margin: 4px 0; }',
      '.game-result { font-family: var(--sg-font-mono, monospace); margin: 8px 0; }',
      '.game-result.win { color: var(--sg-accent, #e8a849); }',
      '.game-result.lose { color: #c0392b; }',
      '@media (max-width: 500px) { .crib-card { width: 48px; height: 70px; margin: 2px; } .crib-btn { padding: 8px 16px; font-size: 13px; } }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function init() {
    app = document.getElementById('bella-cribbage-app');
    if (!app) return;
    injectStyles();
    var savedId = localStorage.getItem('bella_cribbage_id');
    if (savedId) {
      apiCall('state','GET',{game_id:savedId}).then(function(s) {
        if (s && s.game_id && s.phase !== 'gameover') { state = s; render(); }
        else { showNewGame(); }
      }).catch(function(){ showNewGame(); });
    } else { showNewGame(); }
  }

  function showNewGame() {
    app.innerHTML = '<div style="text-align:center;padding:40px">'+
      '<h2 style="color:var(--sg-accent,#e8a849);font-family:var(--sg-font-mono,monospace)">Cribbage</h2>'+
      '<p style="color:var(--sg-text-muted,#b0a898)">You vs Bella 🌸</p>'+
      '<button class="crib-btn" id="new-game-start">Deal Me In</button></div>';
    injectStyles();
    $('#new-game-start').addEventListener('click', function(){
      apiCall('new','POST',{}).then(function(s){
        state = s;
        localStorage.setItem('bella_cribbage_id', s.game_id);
        selectedCards = [];
        render();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
