(function() {
  "use strict";

  var API = (window.BellaChess && BellaChess.api) || '/wp-json/bella/v1/chess/';
  var NONCE = (window.BellaChess && BellaChess.nonce) || '';

  var PIECES = {
    K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',
    k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'
  };
  var FILES = 'abcdefgh';

  var state = null;
  var selected = null;
  var legalMoves = [];
  var waiting = false;
  var app;

  function $(sel,ctx) { return (ctx||document).querySelector(sel); }

  function apiCall(endpoint, method, body) {
    var opts = { method: method, headers: {'Content-Type':'application/json'} };
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    var url = API + endpoint;
    if (method === 'GET' && body) {
      url += '?' + Object.keys(body).map(function(k){return k+'='+encodeURIComponent(body[k])}).join('&');
    }
    return fetch(url, opts).then(function(r) { return r.json(); });
  }

  function toAlg(r,c) { return FILES[c]+(8-r); }
  function pieceColor(p) { return p ? (p===p.toUpperCase()?'w':'b') : null; }

  function getClientMoves(r,c) {
    if (!state || !state.board) return [];
    var piece = state.board[r][c];
    if (!piece || pieceColor(piece) !== 'w') return [];
    var moves = [];
    var board = state.board;
    var type = piece.toUpperCase();

    if (type==='P') {
      if (r-1>=0 && !board[r-1][c]) { moves.push([r-1,c]); if (r===6 && !board[r-2][c]) moves.push([r-2,c]); }
      [-1,1].forEach(function(dc){ var nc=c+dc; if(nc>=0&&nc<8&&r-1>=0&&board[r-1][nc]&&pieceColor(board[r-1][nc])==='b') moves.push([r-1,nc]); });
    }
    if (type==='N') { [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(function(d){ var nr=r+d[0],nc=c+d[1]; if(nr>=0&&nr<8&&nc>=0&&nc<8&&pieceColor(board[nr][nc])!=='w') moves.push([nr,nc]); }); }
    if (type==='B'||type==='Q') { [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(function(d){ for(var i=1;i<8;i++){var nr=r+d[0]*i,nc=c+d[1]*i;if(nr<0||nr>7||nc<0||nc>7)break;if(board[nr][nc]){if(pieceColor(board[nr][nc])!=='w')moves.push([nr,nc]);break;}moves.push([nr,nc]);} }); }
    if (type==='R'||type==='Q') { [[-1,0],[1,0],[0,-1],[0,1]].forEach(function(d){ for(var i=1;i<8;i++){var nr=r+d[0]*i,nc=c+d[1]*i;if(nr<0||nr>7||nc<0||nc>7)break;if(board[nr][nc]){if(pieceColor(board[nr][nc])!=='w')moves.push([nr,nc]);break;}moves.push([nr,nc]);} }); }
    if (type==='K') { [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(function(d){ var nr=r+d[0],nc=c+d[1]; if(nr>=0&&nr<8&&nc>=0&&nc<8&&pieceColor(board[nr][nc])!=='w') moves.push([nr,nc]); }); if(r===7&&c===4){if(!board[7][5]&&!board[7][6])moves.push([7,6]);if(!board[7][3]&&!board[7][2]&&!board[7][1])moves.push([7,2]);} }
    return moves;
  }

  function render() {
    if (!state || !app) return;
    var html = '';
    html += '<div class="chess-status-bar" id="chess-status"></div>';
    html += '<div class="chess-board-wrap"><div class="chess-board" id="chess-board"></div></div>';
    html += '<div class="chess-moves-wrap"><div class="chess-moves" id="chess-moves"></div></div>';
    html += '<div class="chess-buttons"><button class="chess-btn" id="chess-new">New Game</button></div>';
    app.innerHTML = html;
    renderBoard();
    renderStatus();
    renderMoves();
    $('#chess-new').addEventListener('click', function(){
      apiCall('new','POST',{}).then(function(s){
        state=s; selected=null; legalMoves=[]; waiting=false;
        localStorage.setItem('bella_chess_id', s.game_id);
        render();
      });
    });
  }

  function renderBoard() {
    var el = $('#chess-board');
    if (!el || !state) return;
    el.innerHTML = '';
    for (var r=0;r<8;r++) {
      for (var c=0;c<8;c++) {
        var sq = document.createElement('div');
        var light = (r+c)%2===0;
        sq.className = 'chess-sq ' + (light?'light':'dark');
        if (selected && selected[0]===r && selected[1]===c) sq.classList.add('selected');
        var isTarget = legalMoves.some(function(m){return m[0]===r&&m[1]===c;});
        if (isTarget) { sq.classList.add('move-target'); if (state.board[r][c]) sq.classList.add('has-capture'); }
        if (state.in_check && state.board[r][c] === 'K') sq.classList.add('in-check');
        var piece = state.board[r][c];
        if (piece) {
          var span = document.createElement('span');
          span.className = 'chess-piece' + (pieceColor(piece)==='w'?' white':' black');
          span.textContent = PIECES[piece] || piece;
          sq.appendChild(span);
        }
        if (isTarget && !piece) {
          var dot = document.createElement('div');
          dot.className = 'move-dot';
          sq.appendChild(dot);
        }
        (function(r2,c2){ sq.addEventListener('click', function(){ clickSquare(r2,c2); }); })(r,c);
        el.appendChild(sq);
      }
    }
  }

  function clickSquare(r,c) {
    if (!state || state.status !== 'playing' || state.turn !== 'w' || waiting) return;
    if (selected) {
      var isTarget = legalMoves.some(function(m){return m[0]===r&&m[1]===c;});
      if (isTarget) {
        var from = toAlg(selected[0],selected[1]);
        var to = toAlg(r,c);
        var promo = null;
        var piece = state.board[selected[0]][selected[1]];
        if (piece === 'P' && r === 0) promo = 'Q';
        waiting = true; selected = null; legalMoves = [];
        renderBoard(); renderStatus();
        apiCall('move','POST',{game_id:state.game_id,from:from,to:to,promotion:promo}).then(function(s){
          if (s.code) { waiting = false; render(); return; }
          state = s; waiting = false; selected = null; legalMoves = []; render();
        }).catch(function(){ waiting=false; render(); });
        return;
      }
      if (state.board[r][c] && pieceColor(state.board[r][c])==='w') {
        selected = [r,c]; legalMoves = getClientMoves(r,c); renderBoard(); return;
      }
      selected = null; legalMoves = []; renderBoard(); return;
    }
    if (state.board[r][c] && pieceColor(state.board[r][c])==='w') {
      selected = [r,c]; legalMoves = getClientMoves(r,c); renderBoard();
    }
  }

  function renderStatus() {
    var el = $('#chess-status');
    if (!el) return;
    if (state.status !== 'playing') {
      el.textContent = state.message || state.status;
      el.className = 'chess-status-bar game-over';
    } else if (waiting) {
      el.textContent = 'Bella is thinking… 🌸';
      el.className = 'chess-status-bar thinking';
    } else if (state.in_check) {
      el.textContent = 'Check! Your move.';
      el.className = 'chess-status-bar in-check';
    } else {
      el.textContent = state.turn === 'w' ? 'Your move (White)' : "Bella's turn (Black)";
      el.className = 'chess-status-bar';
    }
  }

  function renderMoves() {
    var el = $('#chess-moves');
    if (!el) return;
    if (!state.moves || !state.moves.length) {
      el.innerHTML = '<em>No moves yet. You play White!</em>';
      return;
    }
    var html = '';
    for (var i=0;i<state.moves.length;i+=2) {
      html += '<div class="move-pair"><span class="move-num">'+(Math.floor(i/2)+1)+'.</span> '
        +'<span class="white-move">'+(state.moves[i]||'')+'</span> '
        +'<span class="black-move">'+(state.moves[i+1]||'')+'</span></div>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '#bella-chess-app { max-width: 520px; margin: 0 auto; padding: 16px; }',
      '.chess-status-bar { background: var(--sg-bg-subtle, #1a1a1a); border: 1px solid var(--sg-border, #2a2520); border-radius: var(--sg-radius-md, 8px); padding: 10px 16px; margin-bottom: 12px; font-family: var(--sg-font-mono, monospace); font-size: 14px; text-align: center; color: var(--sg-text-muted, #b0a898); }',
      '.chess-status-bar.thinking { color: var(--sg-accent, #e8a849); }',
      '.chess-status-bar.in-check { color: #ff6b6b; border-color: #ff4444; }',
      '.chess-status-bar.game-over { color: var(--sg-accent, #e8a849); font-weight: bold; }',
      '.chess-board-wrap { display: flex; justify-content: center; }',
      '.chess-board { display: grid; grid-template-columns: repeat(8, 1fr); width: min(400px, 100%); aspect-ratio: 1 / 1; border: 2px solid var(--sg-border, #2a2520); border-radius: var(--sg-radius-sm, 4px); overflow: hidden; }',
      '.chess-sq { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; aspect-ratio: 1 / 1; }',
      '.chess-sq.light { background: #e0d0b8; }',
      '.chess-sq.dark { background: #9e7c5c; }',
      '.chess-sq.selected { background: var(--sg-accent, #e8a849) !important; opacity: 0.85; }',
      '.chess-sq.move-target { cursor: pointer; }',
      '.chess-sq.has-capture { background: rgba(255,80,80,0.35) !important; }',
      '.chess-sq.in-check { background: #ff6b6b !important; }',
      '.move-dot { width: 25%; height: 25%; border-radius: 50%; background: rgba(0,0,0,0.2); }',
      '.chess-piece { font-size: min(5vw, 40px); line-height: 1; user-select: none; pointer-events: none; }',
      '.chess-piece.white { filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.3)); }',
      '.chess-piece.black { filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.3)); }',
      '.chess-moves-wrap { margin-top: 12px; }',
      '.chess-moves { background: var(--sg-bg-subtle, #1a1a1a); border: 1px solid var(--sg-border, #2a2520); border-radius: var(--sg-radius-md, 8px); padding: 10px; max-height: 150px; overflow-y: auto; font-family: var(--sg-font-mono, monospace); font-size: 13px; }',
      '.move-pair { display: inline-block; margin: 2px 8px 2px 0; }',
      '.move-num { color: var(--sg-text-faint, #555); }',
      '.white-move { color: var(--sg-text, #e0d8cf); }',
      '.black-move { color: var(--sg-accent, #e8a849); }',
      '.chess-buttons { margin-top: 12px; text-align: center; }',
      '.chess-btn { background: var(--sg-accent, #e8a849); color: var(--sg-bg, #0d0d0d); border: none; padding: 10px 24px; border-radius: var(--sg-radius-md, 8px); font-family: var(--sg-font-mono, monospace); font-size: 14px; font-weight: bold; cursor: pointer; transition: opacity var(--sg-transition, 0.2s); }',
      '.chess-btn:hover { opacity: 0.85; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function init() {
    app = document.getElementById('bella-chess-app');
    if (!app) return;
    injectStyles();
    var savedId = localStorage.getItem('bella_chess_id');
    if (savedId) {
      apiCall('state','GET',{game_id:savedId}).then(function(s) {
        if (s && s.game_id && s.status === 'playing') { state = s; render(); }
        else { newGame(); }
      }).catch(function(){ newGame(); });
    } else { newGame(); }
  }

  function newGame() {
    apiCall('new','POST',{}).then(function(s){
      state = s;
      localStorage.setItem('bella_chess_id', s.game_id);
      selected = null; legalMoves = []; waiting = false;
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
