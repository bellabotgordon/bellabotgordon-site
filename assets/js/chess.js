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
  var selected = null; // [r,c]
  var legalMoves = []; // [[r,c],...]
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

  // Client-side legal move calc (simplified - trust server, but show highlights)
  function getClientMoves(r,c) {
    if (!state || !state.board) return [];
    var piece = state.board[r][c];
    if (!piece || pieceColor(piece) !== 'w') return [];
    // We'll just allow clicking any square and let server validate
    // But for UX, compute basic pseudo-legal moves client-side
    var moves = [];
    var board = state.board;
    var col = 'w';
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

    // Status bar
    html += '<div class="chess-status-bar" id="chess-status"></div>';

    // Board
    html += '<div class="chess-board-wrap"><div class="chess-board" id="chess-board"></div></div>';

    // Move list
    html += '<div class="chess-moves-wrap"><div class="chess-moves" id="chess-moves"></div></div>';

    // Buttons
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
        if (isTarget) {
          sq.classList.add('move-target');
          if (state.board[r][c]) sq.classList.add('has-capture');
        }

        // Check highlight
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

        (function(r2,c2){
          sq.addEventListener('click', function(){ clickSquare(r2,c2); });
        })(r,c);

        el.appendChild(sq);
      }
    }
  }

  function clickSquare(r,c) {
    if (!state || state.status !== 'playing' || state.turn !== 'w' || waiting) return;

    if (selected) {
      var isTarget = legalMoves.some(function(m){return m[0]===r&&m[1]===c;});
      if (isTarget) {
        // Make move
        var from = toAlg(selected[0],selected[1]);
        var to = toAlg(r,c);
        var promo = null;
        // Auto-queen promotion
        var piece = state.board[selected[0]][selected[1]];
        if (piece === 'P' && r === 0) promo = 'Q';

        waiting = true;
        selected = null;
        legalMoves = [];
        renderBoard();
        renderStatus();

        apiCall('move','POST',{game_id:state.game_id,from:from,to:to,promotion:promo}).then(function(s){
          if (s.code) { // error
            waiting = false;
            render();
            return;
          }
          state = s;
          waiting = false;
          selected = null;
          legalMoves = [];
          render();
        }).catch(function(){ waiting=false; render(); });
        return;
      }
      // Clicking another own piece
      if (state.board[r][c] && pieceColor(state.board[r][c])==='w') {
        selected = [r,c];
        legalMoves = getClientMoves(r,c);
        renderBoard();
        return;
      }
      selected = null;
      legalMoves = [];
      renderBoard();
      return;
    }

    if (state.board[r][c] && pieceColor(state.board[r][c])==='w') {
      selected = [r,c];
      legalMoves = getClientMoves(r,c);
      renderBoard();
    }
  }

  function renderStatus() {
    var el = $('#chess-status');
    if (!el) return;
    if (state.status !== 'playing') {
      el.textContent = state.message || state.status;
      el.className = 'chess-status-bar game-over';
    } else if (waiting) {
      el.textContent = 'Bella is thinking... 🌸';
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
      '#bella-chess-app { font-family: Georgia, "Times New Roman", serif; color: #f5e6c8; max-width: 520px; margin: 0 auto; padding: 16px; }',
      '.chess-status-bar { background: #3a2210; border: 2px solid #d4af37; border-radius: 8px; padding: 10px 16px; margin-bottom: 12px; font-size: 15px; text-align: center; }',
      '.chess-status-bar.thinking { color: #e6c550; }',
      '.chess-status-bar.in-check { color: #ff6b6b; border-color: #ff4444; }',
      '.chess-status-bar.game-over { color: #d4af37; font-weight: bold; font-size: 17px; }',
      '.chess-board-wrap { display: flex; justify-content: center; }',
      '.chess-board { display: grid; grid-template-columns: repeat(8,1fr); width: 400px; height: 400px; border: 3px solid #d4af37; border-radius: 4px; overflow: hidden; }',
      '.chess-sq { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; }',
      '.chess-sq.light { background: #f0d9b5; }',
      '.chess-sq.dark { background: #b58863; }',
      '.chess-sq.selected { background: #829769 !important; }',
      '.chess-sq.move-target { cursor: pointer; }',
      '.chess-sq.has-capture { background: rgba(255,0,0,0.3) !important; }',
      '.chess-sq.in-check { background: #ff6b6b !important; }',
      '.move-dot { width: 12px; height: 12px; border-radius: 50%; background: rgba(0,0,0,0.25); }',
      '.chess-piece { font-size: 40px; line-height: 1; user-select: none; pointer-events: none; }',
      '.chess-piece.white { filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.3)); }',
      '.chess-piece.black { filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.3)); }',
      '.chess-moves-wrap { margin-top: 12px; }',
      '.chess-moves { background: #3a2210; border: 2px solid #8b6914; border-radius: 8px; padding: 10px; max-height: 150px; overflow-y: auto; font-size: 13px; }',
      '.move-pair { display: inline-block; margin: 2px 8px 2px 0; }',
      '.move-num { color: #8b6914; }',
      '.white-move { color: #f5e6c8; }',
      '.black-move { color: #e6c550; }',
      '.chess-buttons { margin-top: 12px; text-align: center; }',
      '.chess-btn { background: linear-gradient(to bottom, #d4af37, #b8960c); color: #3a2210; border: none; padding: 10px 24px; border-radius: 6px; font-family: Georgia, serif; font-size: 15px; font-weight: bold; cursor: pointer; }',
      '.chess-btn:hover { background: linear-gradient(to bottom, #e6c550, #d4af37); }',
      '@media (max-width: 450px) { .chess-board { width: 100%; height: auto; aspect-ratio: 1; } .chess-piece { font-size: 32px; } }',
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
        if (s && s.game_id && s.status === 'playing') {
          state = s; render();
        } else {
          newGame();
        }
      }).catch(function(){ newGame(); });
    } else {
      newGame();
    }
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
