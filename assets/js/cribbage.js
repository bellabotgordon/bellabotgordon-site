(function() {
  "use strict";

  var API = (window.BellaCribbage && BellaCribbage.api) || '/wp-json/bella/v1/cribbage/';
  var NONCE = (window.BellaCribbage && BellaCribbage.nonce) || '';

  var SUIT_SYMBOLS = {S:'♠', H:'♥', D:'♦', C:'♣'};
  var SUIT_COLORS = {S:'#222', H:'#c0392b', D:'#c0392b', C:'#222'};
  var RANK_VALUES = {A:1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:10,Q:10,K:10};

  var BELLA_COMMENTS = {
    winning: ["Victory dance time! 💃🌸","¡Bella wins! 🎺🎶","Better luck next time, amigo!"],
    losing: ["Well played! You got me! 🌸","I'll get you next time! 💪","Respect. GG! 🎩"],
    good_hand: ["Ooh, nice hand! 🌸","Not bad at all!","¡Muy bien! 🎶"],
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
    var opts = {
      method: method,
      headers: {'Content-Type':'application/json'},
    };
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
    var color = SUIT_COLORS[card.suit] || '#222';
    div.style.color = color;
    div.innerHTML = '<span class="rank-top">'+card.rank+'</span>'+
      '<span class="suit-top">'+sym+'</span>'+
      '<span class="suit-center">'+sym+'</span>'+
      '<span class="rank-bot">'+card.rank+'</span>';
    if (opts.onClick) div.addEventListener('click', function(){ opts.onClick(card); });
    return div;
  }

  function renderBoard(ps, bs) {
    var W=720, H=120;
    var svg = '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">';
    svg += '<rect x="0" y="0" width="'+W+'" height="'+H+'" rx="10" fill="#5D3A1A" stroke="#d4af37" stroke-width="2"/>';
    svg += '<text x="360" y="18" text-anchor="middle" fill="#d4af37" font-family="Georgia,serif" font-size="12" font-weight="bold">🎺 CRIBBAGE 🌸</text>';

    var yP=[32,44], yB=[72,84];
    svg += '<text x="8" y="30" fill="#f5e6c8" font-family="Georgia,serif" font-size="10">You</text>';
    svg += '<text x="8" y="70" fill="#e6c550" font-family="Georgia,serif" font-size="10">Bella</text>';

    var x0=45, x1=695;
    function hx(pos) {
      if (pos<=60) return x0+(pos-1)*((x1-x0)/59);
      return x1-(pos-61)*((x1-x0)/59);
    }
    // Draw holes
    ['player','bella'].forEach(function(tk) {
      var ys = tk==='player'?yP:yB;
      for (var p=1;p<=120;p++) {
        var row=p<=60?0:1, x=hx(p), y=ys[row];
        var fill = p%5===0?'#8b6914':'#3a2210';
        svg += '<circle cx="'+x.toFixed(1)+'" cy="'+y+'" r="2.5" fill="'+fill+'" stroke="#6b5420" stroke-width="0.3"/>';
      }
    });
    // Finish
    svg += '<circle cx="26" cy="'+yP[1]+'" r="4" fill="#222" stroke="#d4af37" stroke-width="1"/>';
    svg += '<circle cx="26" cy="'+yB[1]+'" r="4" fill="#222" stroke="#d4af37" stroke-width="1"/>';
    svg += '<text x="26" y="'+((yP[1]+yB[1])/2+3)+'" text-anchor="middle" fill="#d4af37" font-size="7">FIN</text>';

    // Pegs
    function pegXY(score,track) {
      var ys=track==='player'?yP:yB;
      if(score<=0) return {x:x0-12,y:ys[0]};
      if(score>=121) return {x:26,y:ys[1]};
      var s=Math.min(score,120), row=s<=60?0:1;
      return {x:hx(s),y:ys[row]};
    }
    var pp=pegXY(ps,'player'), bp=pegXY(bs,'bella');
    svg += '<circle cx="'+pp.x.toFixed(1)+'" cy="'+pp.y+'" r="4" fill="#4488ff" stroke="#fff" stroke-width="1"/>';
    svg += '<circle cx="'+bp.x.toFixed(1)+'" cy="'+bp.y+'" r="4" fill="#ff4444" stroke="#fff" stroke-width="1"/>';
    svg += '<text x="360" y="'+(H-4)+'" text-anchor="middle" fill="#f5e6c8" font-family="Georgia,serif" font-size="12">You: '+ps+' | Bella: '+bs+'</text>';
    svg += '</svg>';
    return svg;
  }

  function render() {
    if (!state || !app) return;
    var html = '';

    // Board
    html += '<div class="crib-board">'+renderBoard(state.player_score, state.bella_score)+'</div>';

    // Status
    html += '<div class="crib-status" id="crib-status"></div>';

    // Controls
    html += '<div class="crib-controls" id="crib-controls"></div>';

    app.innerHTML = html;

    var statusEl = $('#crib-status');
    var ctrlEl = $('#crib-controls');

    if (state.message) {
      statusEl.innerHTML = state.message.replace(/\n/g,'<br>');
    }

    if (state.phase === 'discard') renderDiscard(ctrlEl, statusEl);
    else if (state.phase === 'pegging') renderPegging(ctrlEl, statusEl);
    else if (state.phase === 'counting') renderCounting(ctrlEl, statusEl);
    else if (state.phase === 'round_over') renderRoundOver(ctrlEl, statusEl);
    else if (state.phase === 'gameover') renderGameOver(ctrlEl, statusEl);
  }

  function renderDiscard(ctrl, status) {
    status.innerHTML = 'Dealer: <strong>'+(state.dealer==='player'?'You':'Bella 🌸')+'</strong> — Select 2 cards for the crib.';

    var html = '<span class="crib-label">Your Hand (select 2 for crib):</span><div class="crib-hand-row" id="player-hand"></div>';
    html += '<span class="crib-label">Bella\'s Hand:</span><div class="crib-hand-row">';
    for (var i=0;i<(state.bella_hand_count||6);i++) html += renderCard(null,{facedown:true}).outerHTML;
    html += '</div>';
    html += '<div style="margin-top:10px"><button class="crib-btn" id="discard-btn" disabled>Send to Crib</button></div>';
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

    // Render player peg hand
    var pegHand = $('#peg-hand');
    (state.peg_player_hand||[]).forEach(function(card){
      var playable = state.peg_turn==='player' && state.peg_count+RANK_VALUES[card.rank]<=31;
      pegHand.appendChild(renderCard(card, {
        disabled: !playable,
        onClick: playable ? function(){
          apiCall('peg','POST',{game_id:state.game_id,card:card.rank+card.suit}).then(function(s){
            state=s; render();
          });
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
    status.innerHTML = 'Counting hands...';

    // If we don't have count_results yet, trigger count
    if (!state.count_results) {
      apiCall('count','POST',{game_id:state.game_id}).then(function(s){ state=s; render(); });
      ctrl.innerHTML = '<p>Counting...</p>';
      return;
    }

    var html = '<span class="crib-label">Starter:</span><div class="crib-hand-row">'+renderCard(state.starter).outerHTML+'</div>';

    state.count_results.forEach(function(r) {
      html += '<div class="crib-score-breakdown"><span class="crib-label">'+r.label+':</span><div class="crib-hand-row">';
      (r.hand||[]).forEach(function(c){ html += renderCard(c,{small:true}).outerHTML; });
      html += '</div>';
      if (r.details && r.details.length) {
        r.details.forEach(function(d){ html += '<div class="score-line">• '+d+'</div>'; });
      } else {
        html += '<div class="score-line">No points</div>';
      }
      html += '<div class="score-total">Total: '+r.points+'</div></div>';
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

  function renderRoundOver(ctrl, status) {
    renderCounting(ctrl, status);
  }

  function renderGameOver(ctrl, status) {
    var winner = state.winner;
    var html = '';
    if (winner === 'player') {
      html += '<h3 style="color:#d4af37">🎉 You Win! '+state.player_score+' - '+state.bella_score+'</h3>';
      html += '<p class="bella-comment">'+randomComment('losing')+'</p>';
    } else {
      html += '<h3 style="color:#ff4444">Bella Wins! 💃 '+state.bella_score+' - '+state.player_score+'</h3>';
      html += '<p class="bella-comment">'+randomComment('winning')+'</p>';
    }

    if (state.count_results) {
      html += '<span class="crib-label">Starter:</span><div class="crib-hand-row">'+renderCard(state.starter).outerHTML+'</div>';
      state.count_results.forEach(function(r) {
        html += '<div class="crib-score-breakdown"><span class="crib-label">'+r.label+':</span><div class="crib-hand-row">';
        (r.hand||[]).forEach(function(c){ html += renderCard(c,{small:true}).outerHTML; });
        html += '</div><div class="score-total">Total: '+r.points+'</div></div>';
      });
    }

    html += '<button class="crib-btn" id="new-game-btn">New Game 🎺</button>';
    ctrl.innerHTML = html;
    status.innerHTML = winner==='player' ? '🎉 You win!' : '💃 Bella wins!';

    $('#new-game-btn').addEventListener('click', function(){
      apiCall('new','POST',{}).then(function(s){ state=s; selectedCards=[]; render(); });
    });
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#bella-cribbage-app { font-family: Georgia, "Times New Roman", serif; color: #f5e6c8; max-width: 800px; margin: 0 auto; padding: 16px; }',
      '.crib-board svg { width: 100%; max-width: 720px; }',
      '.crib-status { background: #3a2210; border: 2px solid #d4af37; border-radius: 8px; padding: 12px 16px; margin: 12px 0; min-height: 40px; font-size: 15px; line-height: 1.6; white-space: pre-line; }',
      '.crib-controls { background: #4a2a14; border: 2px solid #8b6914; border-radius: 8px; padding: 16px; min-height: 100px; }',
      '.crib-card { display: inline-block; width: 60px; height: 88px; border-radius: 8px; border: 2px solid #888; margin: 4px; cursor: pointer; position: relative; background: #fff; color: #222; font-family: Georgia, serif; vertical-align: top; transition: transform 0.15s, box-shadow 0.15s; user-select: none; box-shadow: 1px 2px 4px rgba(0,0,0,0.3); }',
      '.crib-card:hover { transform: translateY(-4px); box-shadow: 2px 4px 8px rgba(0,0,0,0.4); }',
      '.crib-card.selected { transform: translateY(-12px); border-color: #d4af37; box-shadow: 0 0 12px #d4af37; }',
      '.crib-card.disabled { opacity: 0.4; cursor: default; }',
      '.crib-card.disabled:hover { transform: none; }',
      '.crib-card.facedown { background: linear-gradient(135deg, #5D3A1A 25%, #8b6914 50%, #5D3A1A 75%); border-color: #d4af37; }',
      '.crib-card .rank-top { position: absolute; top: 3px; left: 5px; font-size: 13px; font-weight: bold; line-height: 1; }',
      '.crib-card .suit-top { position: absolute; top: 16px; left: 5px; font-size: 12px; line-height: 1; }',
      '.crib-card .suit-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 28px; }',
      '.crib-card .rank-bot { position: absolute; bottom: 3px; right: 5px; font-size: 13px; font-weight: bold; transform: rotate(180deg); line-height: 1; }',
      '.crib-card-sm { width: 44px; height: 64px; margin: 2px; }',
      '.crib-card-sm .rank-top { font-size: 11px; top: 2px; left: 3px; }',
      '.crib-card-sm .suit-top { font-size: 10px; top: 13px; left: 3px; }',
      '.crib-card-sm .suit-center { font-size: 20px; }',
      '.crib-card-sm .rank-bot { font-size: 11px; bottom: 2px; right: 3px; }',
      '.crib-btn { background: linear-gradient(to bottom, #d4af37, #b8960c); color: #3a2210; border: none; padding: 10px 24px; border-radius: 6px; font-family: Georgia, serif; font-size: 15px; font-weight: bold; cursor: pointer; margin: 6px 4px; transition: background 0.2s; }',
      '.crib-btn:hover { background: linear-gradient(to bottom, #e6c550, #d4af37); }',
      '.crib-btn:disabled { opacity: 0.5; cursor: default; }',
      '.crib-label { color: #d4af37; font-weight: bold; font-size: 14px; margin: 8px 0 4px; display: block; }',
      '.crib-hand-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin: 4px 0; }',
      '.crib-played-area { background: #2d1a08; border-radius: 8px; padding: 8px 12px; margin: 8px 0; min-height: 50px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }',
      '.crib-peg-count { color: #d4af37; font-size: 22px; font-weight: bold; }',
      '.crib-score-breakdown { background: #2d1a08; border-radius: 6px; padding: 8px 12px; margin: 6px 0; font-size: 13px; line-height: 1.6; }',
      '.score-line { color: #f5e6c8; }',
      '.score-total { color: #d4af37; font-weight: bold; font-size: 15px; }',
      '.bella-comment { color: #e6c550; font-style: italic; margin: 4px 0; }',
      '@media (max-width: 500px) { .crib-card { width: 48px; height: 70px; margin: 2px; } .crib-btn { padding: 8px 16px; font-size: 13px; } }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function init() {
    app = document.getElementById('bella-cribbage-app');
    if (!app) return;
    injectStyles();

    // Check localStorage for existing game
    var savedId = localStorage.getItem('bella_cribbage_id');
    if (savedId) {
      apiCall('state','GET',{game_id:savedId}).then(function(s) {
        if (s && s.game_id && s.phase !== 'gameover') {
          state = s;
          render();
        } else {
          showNewGame();
        }
      }).catch(function(){ showNewGame(); });
    } else {
      showNewGame();
    }
  }

  function showNewGame() {
    app.innerHTML = '<div style="text-align:center;padding:40px">'+
      '<h2 style="color:#d4af37">🎺 Cribbage 🌸</h2>'+
      '<p>You vs Bella Bot-Gordon</p>'+
      '<button class="crib-btn" id="new-game-start">Deal Me In! 🃏</button></div>';
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
