<?php
/**
 * Bella's Chess Game - REST API + Game Engine with AI
 * Full server-side chess with minimax AI opponent
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Bella_Chess {

    const FILES = 'abcdefgh';
    const PIECE_VALUES = [ 'P' => 100, 'N' => 320, 'B' => 330, 'R' => 500, 'Q' => 900, 'K' => 20000 ];

    // Piece-square tables (from white's perspective, index 0=a8)
    const PST_PAWN = [
         0,  0,  0,  0,  0,  0,  0,  0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
         5,  5, 10, 25, 25, 10,  5,  5,
         0,  0,  0, 20, 20,  0,  0,  0,
         5, -5,-10,  0,  0,-10, -5,  5,
         5, 10, 10,-20,-20, 10, 10,  5,
         0,  0,  0,  0,  0,  0,  0,  0,
    ];
    const PST_KNIGHT = [
        -50,-40,-30,-30,-30,-30,-40,-50,
        -40,-20,  0,  0,  0,  0,-20,-40,
        -30,  0, 10, 15, 15, 10,  0,-30,
        -30,  5, 15, 20, 20, 15,  5,-30,
        -30,  0, 15, 20, 20, 15,  0,-30,
        -30,  5, 10, 15, 15, 10,  5,-30,
        -40,-20,  0,  5,  5,  0,-20,-40,
        -50,-40,-30,-30,-30,-30,-40,-50,
    ];
    const PST_BISHOP = [
        -20,-10,-10,-10,-10,-10,-10,-20,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -10,  0, 10, 10, 10, 10,  0,-10,
        -10,  5,  5, 10, 10,  5,  5,-10,
        -10,  0, 10, 10, 10, 10,  0,-10,
        -10, 10, 10, 10, 10, 10, 10,-10,
        -10,  5,  0,  0,  0,  0,  5,-10,
        -20,-10,-10,-10,-10,-10,-10,-20,
    ];
    const PST_ROOK = [
         0,  0,  0,  0,  0,  0,  0,  0,
         5, 10, 10, 10, 10, 10, 10,  5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
         0,  0,  0,  5,  5,  0,  0,  0,
    ];
    const PST_QUEEN = [
        -20,-10,-10, -5, -5,-10,-10,-20,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -10,  0,  5,  5,  5,  5,  0,-10,
         -5,  0,  5,  5,  5,  5,  0, -5,
          0,  0,  5,  5,  5,  5,  0, -5,
        -10,  5,  5,  5,  5,  5,  0,-10,
        -10,  0,  5,  0,  0,  0,  0,-10,
        -20,-10,-10, -5, -5,-10,-10,-20,
    ];
    const PST_KING = [
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20,
        -10,-20,-20,-20,-20,-20,-20,-10,
         20, 20,  0,  0,  0,  0, 20, 20,
         20, 30, 10,  0,  0, 10, 30, 20,
    ];

    public function init() {
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
        add_shortcode( 'bella_chess', [ $this, 'render_shortcode' ] );
        add_action( 'wp_enqueue_scripts', [ $this, 'maybe_enqueue' ] );
    }

    public function register_routes() {
        $ns = 'bella/v1/chess';
        register_rest_route( $ns, '/new', [
            'methods' => 'POST', 'callback' => [ $this, 'api_new' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/state', [
            'methods' => 'GET', 'callback' => [ $this, 'api_state' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/move', [
            'methods' => 'POST', 'callback' => [ $this, 'api_move' ], 'permission_callback' => '__return_true',
        ]);
    }

    public function render_shortcode() {
        return '<div id="bella-chess-app"></div>';
    }

    public function maybe_enqueue() {
        if ( ! is_page( 'chess' ) ) return;
        wp_enqueue_script(
            'bella-chess',
            BELLA_SITE_URL . 'assets/js/chess.js',
            [],
            BELLA_SITE_VERSION,
            true
        );
        wp_localize_script( 'bella-chess', 'BellaChess', [
            'api'   => rest_url( 'bella/v1/chess/' ),
            'nonce' => wp_create_nonce( 'wp_rest' ),
        ]);
    }

    // ── API ──

    public function api_new( $request ) {
        $game_id = wp_generate_uuid4();
        $state = $this->initial_state( $game_id );
        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_state( $request ) {
        $game_id = $request->get_param( 'game_id' );
        $state = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_move( $request ) {
        $params  = $request->get_json_params();
        $game_id = $params['game_id'] ?? '';
        $from    = $params['from'] ?? '';
        $to      = $params['to'] ?? '';
        $promo   = $params['promotion'] ?? null;

        $state = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        if ( $state['status'] !== 'playing' ) return new WP_Error( 'game_over', 'Game is over', [ 'status' => 400 ] );
        if ( $state['turn'] !== 'w' ) return new WP_Error( 'not_turn', 'Not your turn', [ 'status' => 400 ] );

        $fr = $this->alg_to_rc( $from );
        $tr = $this->alg_to_rc( $to );
        if ( ! $fr || ! $tr ) return new WP_Error( 'bad_square', 'Invalid square', [ 'status' => 400 ] );

        $board = $state['board'];
        $piece = $board[ $fr[0] ][ $fr[1] ];
        if ( ! $piece || $this->piece_color( $piece ) !== 'w' ) {
            return new WP_Error( 'bad_piece', 'No white piece there', [ 'status' => 400 ] );
        }

        // Check legality
        $legal = $this->get_legal_moves( $board, $fr[0], $fr[1], $state['castling'], $state['en_passant'], 'w' );
        $move_found = false;
        foreach ( $legal as $m ) {
            if ( $m[0] === $tr[0] && $m[1] === $tr[1] ) { $move_found = true; break; }
        }
        if ( ! $move_found ) return new WP_Error( 'illegal', 'Illegal move', [ 'status' => 400 ] );

        // Apply move
        $notation = $this->move_notation( $board, $fr, $tr, $piece );
        $result = $this->apply_move( $board, $fr, $tr, $state['castling'], $state['en_passant'], $promo );
        $state['board']      = $result['board'];
        $state['castling']   = $result['castling'];
        $state['en_passant'] = $result['en_passant'];
        $state['turn']       = 'b';

        // Check status after player move
        if ( $this->in_check( $state['board'], 'b', $state['castling'], $state['en_passant'] ) ) {
            $notation .= '+';
        }
        $state['moves'][] = $notation;

        if ( ! $this->has_legal_moves( $state['board'], 'b', $state['castling'], $state['en_passant'] ) ) {
            if ( $this->in_check( $state['board'], 'b', $state['castling'], $state['en_passant'] ) ) {
                $state['status'] = 'checkmate';
                $state['winner'] = 'player';
                $state['message'] = 'Checkmate! You win! 🎉';
            } else {
                $state['status'] = 'stalemate';
                $state['message'] = 'Stalemate! Draw.';
            }
            $this->save_state( $game_id, $state );
            return rest_ensure_response( $this->public_state( $state ) );
        }

        // Bella's move
        $bella_move = $this->ai_move( $state['board'], $state['castling'], $state['en_passant'] );
        if ( $bella_move ) {
            $bfr = $bella_move['from'];
            $btr = $bella_move['to'];
            $bpiece = $state['board'][ $bfr[0] ][ $bfr[1] ];
            $bnotation = $this->move_notation( $state['board'], $bfr, $btr, $bpiece );

            $result = $this->apply_move( $state['board'], $bfr, $btr, $state['castling'], $state['en_passant'], $bella_move['promo'] ?? null );
            $state['board']      = $result['board'];
            $state['castling']   = $result['castling'];
            $state['en_passant'] = $result['en_passant'];
            $state['turn']       = 'w';

            if ( $this->in_check( $state['board'], 'w', $state['castling'], $state['en_passant'] ) ) {
                $bnotation .= '+';
            }
            $state['moves'][] = $bnotation;
            $state['bella_move'] = $this->rc_to_alg( $bfr[0], $bfr[1] ) . $this->rc_to_alg( $btr[0], $btr[1] );

            if ( ! $this->has_legal_moves( $state['board'], 'w', $state['castling'], $state['en_passant'] ) ) {
                if ( $this->in_check( $state['board'], 'w', $state['castling'], $state['en_passant'] ) ) {
                    $state['status'] = 'checkmate';
                    $state['winner'] = 'bella';
                    $state['message'] = 'Checkmate! Bella wins! 🌸';
                } else {
                    $state['status'] = 'stalemate';
                    $state['message'] = 'Stalemate! Draw.';
                }
            }
        }

        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    // ── Board / State ──

    private function initial_state( $game_id ) {
        return [
            'game_id'    => $game_id,
            'board'      => $this->initial_board(),
            'turn'       => 'w',
            'castling'   => [ 'K' => true, 'Q' => true, 'k' => true, 'q' => true ],
            'en_passant' => null,
            'moves'      => [],
            'status'     => 'playing',
            'winner'     => null,
            'message'    => '',
            'bella_move' => null,
            'created'    => time(),
        ];
    }

    private function initial_board() {
        return [
            ['r','n','b','q','k','b','n','r'],
            ['p','p','p','p','p','p','p','p'],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            [null,null,null,null,null,null,null,null],
            ['P','P','P','P','P','P','P','P'],
            ['R','N','B','Q','K','B','N','R'],
        ];
    }

    private function piece_color( $p ) {
        if ( ! $p ) return null;
        return ctype_upper( $p ) ? 'w' : 'b';
    }

    private function alg_to_rc( $s ) {
        if ( strlen($s) < 2 ) return null;
        $c = strpos( self::FILES, $s[0] );
        $r = 8 - intval( $s[1] );
        if ( $c === false || $r < 0 || $r > 7 ) return null;
        return [ $r, $c ];
    }

    private function rc_to_alg( $r, $c ) {
        return self::FILES[$c] . (8 - $r);
    }

    // ── Move Generation ──

    private function get_pseudo_moves( $board, $r, $c, $castling, $en_passant ) {
        $piece = $board[$r][$c];
        if ( ! $piece ) return [];
        $col = $this->piece_color( $piece );
        $type = strtoupper( $piece );
        $moves = [];

        if ( $type === 'P' ) {
            $dir = $col === 'w' ? -1 : 1;
            $start = $col === 'w' ? 6 : 1;
            // Forward
            if ( $r+$dir >= 0 && $r+$dir < 8 && !$board[$r+$dir][$c] ) {
                $moves[] = [$r+$dir, $c];
                if ( $r === $start && !$board[$r+2*$dir][$c] ) $moves[] = [$r+2*$dir, $c];
            }
            // Captures
            foreach ( [-1, 1] as $dc ) {
                $nc = $c + $dc;
                $nr = $r + $dir;
                if ( $nc < 0 || $nc > 7 || $nr < 0 || $nr > 7 ) continue;
                if ( $board[$nr][$nc] && $this->piece_color($board[$nr][$nc]) !== $col ) $moves[] = [$nr, $nc];
                if ( $en_passant && $en_passant[0] === $nr && $en_passant[1] === $nc ) $moves[] = [$nr, $nc];
            }
        }

        if ( $type === 'N' ) {
            foreach ( [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as $d ) {
                $nr = $r+$d[0]; $nc = $c+$d[1];
                if ( $nr>=0 && $nr<8 && $nc>=0 && $nc<8 && $this->piece_color($board[$nr][$nc]) !== $col )
                    $moves[] = [$nr, $nc];
            }
        }

        if ( $type === 'B' || $type === 'Q' ) {
            foreach ( [[-1,-1],[-1,1],[1,-1],[1,1]] as $d ) {
                for ( $i=1; $i<8; $i++ ) {
                    $nr=$r+$d[0]*$i; $nc=$c+$d[1]*$i;
                    if ($nr<0||$nr>7||$nc<0||$nc>7) break;
                    if ($board[$nr][$nc]) {
                        if ($this->piece_color($board[$nr][$nc])!==$col) $moves[]=[$nr,$nc];
                        break;
                    }
                    $moves[]=[$nr,$nc];
                }
            }
        }

        if ( $type === 'R' || $type === 'Q' ) {
            foreach ( [[-1,0],[1,0],[0,-1],[0,1]] as $d ) {
                for ( $i=1; $i<8; $i++ ) {
                    $nr=$r+$d[0]*$i; $nc=$c+$d[1]*$i;
                    if ($nr<0||$nr>7||$nc<0||$nc>7) break;
                    if ($board[$nr][$nc]) {
                        if ($this->piece_color($board[$nr][$nc])!==$col) $moves[]=[$nr,$nc];
                        break;
                    }
                    $moves[]=[$nr,$nc];
                }
            }
        }

        if ( $type === 'K' ) {
            foreach ( [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as $d ) {
                $nr=$r+$d[0]; $nc=$c+$d[1];
                if ($nr>=0&&$nr<8&&$nc>=0&&$nc<8&&$this->piece_color($board[$nr][$nc])!==$col)
                    $moves[]=[$nr,$nc];
            }
            // Castling
            $opp = $col === 'w' ? 'b' : 'w';
            if ( $col === 'w' && $r === 7 && $c === 4 ) {
                if ( !empty($castling['K']) && !$board[7][5] && !$board[7][6] &&
                     !$this->is_attacked($board,7,4,$opp) && !$this->is_attacked($board,7,5,$opp) && !$this->is_attacked($board,7,6,$opp) )
                    $moves[] = [7,6];
                if ( !empty($castling['Q']) && !$board[7][3] && !$board[7][2] && !$board[7][1] &&
                     !$this->is_attacked($board,7,4,$opp) && !$this->is_attacked($board,7,3,$opp) && !$this->is_attacked($board,7,2,$opp) )
                    $moves[] = [7,2];
            }
            if ( $col === 'b' && $r === 0 && $c === 4 ) {
                if ( !empty($castling['k']) && !$board[0][5] && !$board[0][6] &&
                     !$this->is_attacked($board,0,4,$opp) && !$this->is_attacked($board,0,5,$opp) && !$this->is_attacked($board,0,6,$opp) )
                    $moves[] = [0,6];
                if ( !empty($castling['q']) && !$board[0][3] && !$board[0][2] && !$board[0][1] &&
                     !$this->is_attacked($board,0,4,$opp) && !$this->is_attacked($board,0,3,$opp) && !$this->is_attacked($board,0,2,$opp) )
                    $moves[] = [0,2];
            }
        }

        return $moves;
    }

    private function get_legal_moves( $board, $r, $c, $castling, $en_passant, $color ) {
        $piece = $board[$r][$c];
        if ( ! $piece || $this->piece_color($piece) !== $color ) return [];

        $pseudo = $this->get_pseudo_moves( $board, $r, $c, $castling, $en_passant );
        $legal = [];

        foreach ( $pseudo as $m ) {
            $result = $this->apply_move( $board, [$r,$c], $m, $castling, $en_passant, null );
            if ( ! $this->in_check( $result['board'], $color, $result['castling'], $result['en_passant'] ) ) {
                $legal[] = $m;
            }
        }

        return $legal;
    }

    private function is_attacked( $board, $r, $c, $by_color ) {
        // Check all pieces of by_color for attacks on (r,c)
        for ( $rr=0; $rr<8; $rr++ ) {
            for ( $cc=0; $cc<8; $cc++ ) {
                $p = $board[$rr][$cc];
                if ( ! $p || $this->piece_color($p) !== $by_color ) continue;
                $type = strtoupper($p);
                $dr = $r-$rr; $dc = $c-$cc; $ar = abs($dr); $ac = abs($dc);

                if ( $type === 'P' ) {
                    $pdir = $by_color === 'w' ? -1 : 1;
                    if ( $dr === $pdir && $ac === 1 ) return true;
                }
                if ( $type === 'N' && (($ar===2&&$ac===1)||($ar===1&&$ac===2)) ) return true;
                if ( ($type==='B'||$type==='Q') && $ar===$ac && $ar > 0 ) {
                    $sr = $dr > 0 ? 1 : -1; $sc = $dc > 0 ? 1 : -1;
                    $blocked = false;
                    for ( $i=1; $i<$ar; $i++ ) if ( $board[$rr+$sr*$i][$cc+$sc*$i] ) { $blocked=true; break; }
                    if ( !$blocked ) return true;
                }
                if ( ($type==='R'||$type==='Q') && ($dr===0||$dc===0) && ($ar+$ac)>0 ) {
                    $sr = $dr === 0 ? 0 : ($dr>0?1:-1);
                    $sc = $dc === 0 ? 0 : ($dc>0?1:-1);
                    $dist = max($ar,$ac);
                    $blocked = false;
                    for ( $i=1; $i<$dist; $i++ ) if ( $board[$rr+$sr*$i][$cc+$sc*$i] ) { $blocked=true; break; }
                    if ( !$blocked ) return true;
                }
                if ( $type === 'K' && $ar<=1 && $ac<=1 ) return true;
            }
        }
        return false;
    }

    private function find_king( $board, $color ) {
        $king = $color === 'w' ? 'K' : 'k';
        for ( $r=0; $r<8; $r++ ) for ( $c=0; $c<8; $c++ ) if ( $board[$r][$c] === $king ) return [$r,$c];
        return null;
    }

    private function in_check( $board, $color, $castling, $en_passant ) {
        $k = $this->find_king( $board, $color );
        if ( ! $k ) return false;
        $opp = $color === 'w' ? 'b' : 'w';
        return $this->is_attacked( $board, $k[0], $k[1], $opp );
    }

    private function has_legal_moves( $board, $color, $castling, $en_passant ) {
        for ( $r=0; $r<8; $r++ ) {
            for ( $c=0; $c<8; $c++ ) {
                if ( $board[$r][$c] && $this->piece_color($board[$r][$c]) === $color ) {
                    if ( ! empty( $this->get_legal_moves( $board, $r, $c, $castling, $en_passant, $color ) ) ) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private function apply_move( $board, $from, $to, $castling, $en_passant, $promo = null ) {
        $r1=$from[0]; $c1=$from[1]; $r2=$to[0]; $c2=$to[1];
        $piece = $board[$r1][$c1];
        $type = strtoupper($piece);
        $col = $this->piece_color($piece);
        $new_ep = null;

        // En passant capture
        if ( $type === 'P' && $c1 !== $c2 && ! $board[$r2][$c2] ) {
            $board[$r1][$c2] = null; // capture the pawn
        }

        // En passant target
        if ( $type === 'P' && abs($r2-$r1) === 2 ) {
            $new_ep = [ intval(($r1+$r2)/2), $c1 ];
        }

        // Castling
        if ( $type === 'K' && abs($c2-$c1) === 2 ) {
            if ( $c2 === 6 ) { // kingside
                $board[$r1][5] = $board[$r1][7];
                $board[$r1][7] = null;
            } else { // queenside
                $board[$r1][3] = $board[$r1][0];
                $board[$r1][0] = null;
            }
        }

        // Update castling rights
        $new_castling = $castling;
        if ( $type === 'K' ) {
            if ( $col === 'w' ) { $new_castling['K'] = false; $new_castling['Q'] = false; }
            else { $new_castling['k'] = false; $new_castling['q'] = false; }
        }
        if ( $r1===7 && $c1===0 ) $new_castling['Q'] = false;
        if ( $r1===7 && $c1===7 ) $new_castling['K'] = false;
        if ( $r1===0 && $c1===0 ) $new_castling['q'] = false;
        if ( $r1===0 && $c1===7 ) $new_castling['k'] = false;
        if ( $r2===7 && $c2===0 ) $new_castling['Q'] = false;
        if ( $r2===7 && $c2===7 ) $new_castling['K'] = false;
        if ( $r2===0 && $c2===0 ) $new_castling['q'] = false;
        if ( $r2===0 && $c2===7 ) $new_castling['k'] = false;

        // Promotion
        if ( $type === 'P' ) {
            if ( ($col === 'w' && $r2 === 0) || ($col === 'b' && $r2 === 7) ) {
                $promo_piece = $promo ? strtoupper($promo) : 'Q';
                $piece = $col === 'w' ? $promo_piece : strtolower($promo_piece);
            }
        }

        $board[$r2][$c2] = $piece;
        $board[$r1][$c1] = null;

        return [ 'board' => $board, 'castling' => $new_castling, 'en_passant' => $new_ep ];
    }

    private function move_notation( $board, $from, $to, $piece ) {
        $type = strtoupper($piece);
        $captured = $board[$to[0]][$to[1]];

        if ( $type === 'K' && abs($to[1]-$from[1]) === 2 ) {
            return $to[1] > $from[1] ? 'O-O' : 'O-O-O';
        }

        $n = '';
        if ( $type !== 'P' ) $n .= $type;
        if ( $type === 'P' && $from[1] !== $to[1] ) $n .= self::FILES[$from[1]];
        if ( $captured ) $n .= 'x';
        $n .= $this->rc_to_alg( $to[0], $to[1] );

        // Promotion
        if ( $type === 'P' && ($to[0] === 0 || $to[0] === 7) ) $n .= '=Q';

        return $n;
    }

    // ── AI (Minimax + Alpha-Beta) ──

    private function ai_move( $board, $castling, $en_passant ) {
        $all_moves = [];
        for ( $r=0; $r<8; $r++ ) {
            for ( $c=0; $c<8; $c++ ) {
                if ( $board[$r][$c] && $this->piece_color($board[$r][$c]) === 'b' ) {
                    $legal = $this->get_legal_moves( $board, $r, $c, $castling, $en_passant, 'b' );
                    foreach ( $legal as $m ) {
                        $all_moves[] = [ 'from' => [$r,$c], 'to' => $m, 'promo' => null ];
                    }
                }
            }
        }

        if ( empty($all_moves) ) return null;

        // Add promotions
        foreach ( $all_moves as &$mv ) {
            $piece = $board[$mv['from'][0]][$mv['from'][1]];
            if ( strtoupper($piece) === 'P' && $mv['to'][0] === 7 ) {
                $mv['promo'] = 'q';
            }
        }
        unset($mv);

        // Sort moves by heuristic for better alpha-beta pruning
        usort( $all_moves, function($a, $b) use ($board) {
            return $this->move_order_score($board, $b) - $this->move_order_score($board, $a);
        });

        $best_move = $all_moves[0];
        $best_val = -99999;
        $depth = count($all_moves) > 30 ? 3 : 3; // depth 3

        foreach ( $all_moves as $mv ) {
            $result = $this->apply_move( $board, $mv['from'], $mv['to'], $castling, $en_passant, $mv['promo'] );
            $val = -$this->minimax( $result['board'], $result['castling'], $result['en_passant'], $depth - 1, -99999, -$best_val, 'w' );
            if ( $val > $best_val ) {
                $best_val = $val;
                $best_move = $mv;
            }
        }

        return $best_move;
    }

    private function minimax( $board, $castling, $en_passant, $depth, $alpha, $beta, $color ) {
        if ( $depth === 0 ) {
            return $this->evaluate( $board, $color );
        }

        $moves = [];
        for ( $r=0; $r<8; $r++ ) {
            for ( $c=0; $c<8; $c++ ) {
                if ( $board[$r][$c] && $this->piece_color($board[$r][$c]) === $color ) {
                    $legal = $this->get_legal_moves( $board, $r, $c, $castling, $en_passant, $color );
                    foreach ( $legal as $m ) {
                        $promo = null;
                        if ( strtoupper($board[$r][$c]) === 'P' && ($m[0] === 0 || $m[0] === 7) ) {
                            $promo = $color === 'w' ? 'Q' : 'q';
                        }
                        $moves[] = [ [$r,$c], $m, $promo ];
                    }
                }
            }
        }

        if ( empty($moves) ) {
            if ( $this->in_check( $board, $color, $castling, $en_passant ) ) {
                return -99000 - $depth; // checkmate (worse if further from root = already losing)
            }
            return 0; // stalemate
        }

        $best = -99999;
        $opp = $color === 'w' ? 'b' : 'w';

        foreach ( $moves as $mv ) {
            $result = $this->apply_move( $board, $mv[0], $mv[1], $castling, $en_passant, $mv[2] );
            $val = -$this->minimax( $result['board'], $result['castling'], $result['en_passant'], $depth - 1, -$beta, -$alpha, $opp );
            if ( $val > $best ) $best = $val;
            if ( $best > $alpha ) $alpha = $best;
            if ( $alpha >= $beta ) break;
        }

        return $best;
    }

    private function evaluate( $board, $color ) {
        $score = 0;
        for ( $r=0; $r<8; $r++ ) {
            for ( $c=0; $c<8; $c++ ) {
                $p = $board[$r][$c];
                if ( ! $p ) continue;
                $type = strtoupper($p);
                $pc = $this->piece_color($p);
                $val = self::PIECE_VALUES[$type] ?? 0;

                // PST
                $pst = 0;
                $idx = $pc === 'w' ? $r * 8 + $c : (7 - $r) * 8 + $c;
                switch ( $type ) {
                    case 'P': $pst = self::PST_PAWN[$idx]; break;
                    case 'N': $pst = self::PST_KNIGHT[$idx]; break;
                    case 'B': $pst = self::PST_BISHOP[$idx]; break;
                    case 'R': $pst = self::PST_ROOK[$idx]; break;
                    case 'Q': $pst = self::PST_QUEEN[$idx]; break;
                    case 'K': $pst = self::PST_KING[$idx]; break;
                }

                $total = $val + $pst;
                $score += $pc === $color ? $total : -$total;
            }
        }
        return $score;
    }

    private function move_order_score( $board, $move ) {
        $score = 0;
        $captured = $board[$move['to'][0]][$move['to'][1]];
        if ( $captured ) {
            $score += (self::PIECE_VALUES[strtoupper($captured)] ?? 0) * 10;
        }
        if ( $move['promo'] ) $score += 800;
        return $score;
    }

    // ── Storage ──

    private function save_state( $game_id, $state ) {
        update_option( 'bella_chess_' . $game_id, $state, false );
    }

    private function load_state( $game_id ) {
        if ( ! $game_id ) return null;
        return get_option( 'bella_chess_' . $game_id ) ?: null;
    }

    private function public_state( $state ) {
        return [
            'game_id'    => $state['game_id'],
            'board'      => $state['board'],
            'turn'       => $state['turn'],
            'moves'      => $state['moves'],
            'status'     => $state['status'],
            'winner'     => $state['winner'],
            'message'    => $state['message'] ?? '',
            'bella_move' => $state['bella_move'] ?? null,
            'in_check'   => $state['status'] === 'playing' && $state['turn'] === 'w' ?
                            $this->in_check( $state['board'], 'w', $state['castling'], $state['en_passant'] ) : false,
        ];
    }
}
