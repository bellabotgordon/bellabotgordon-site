<?php
/**
 * Bella's Cribbage Game - REST API + Game Engine
 * Full server-side cribbage with AI opponent
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Bella_Cribbage {

    const WIN_SCORE = 121;
    const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const SUITS = ['S','H','D','C']; // spades, hearts, diamonds, clubs
    const RANK_VALUES = ['A'=>1,'2'=>2,'3'=>3,'4'=>4,'5'=>5,'6'=>6,'7'=>7,'8'=>8,'9'=>9,'10'=>10,'J'=>10,'Q'=>10,'K'=>10];
    const RANK_ORDER  = ['A'=>1,'2'=>2,'3'=>3,'4'=>4,'5'=>5,'6'=>6,'7'=>7,'8'=>8,'9'=>9,'10'=>10,'J'=>11,'Q'=>12,'K'=>13];

    public function init() {
        add_action( 'rest_api_init', [ $this, 'register_routes' ] );
        add_shortcode( 'bella_cribbage', [ $this, 'render_shortcode' ] );
        add_action( 'wp_enqueue_scripts', [ $this, 'maybe_enqueue' ] );
    }

    public function register_routes() {
        $ns = 'bella/v1/cribbage';
        $opts = [ 'permission_callback' => '__return_true' ];

        register_rest_route( $ns, '/new', [
            'methods' => 'POST', 'callback' => [ $this, 'api_new' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/state', [
            'methods' => 'GET', 'callback' => [ $this, 'api_state' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/discard', [
            'methods' => 'POST', 'callback' => [ $this, 'api_discard' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/peg', [
            'methods' => 'POST', 'callback' => [ $this, 'api_peg' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/peg-pass', [
            'methods' => 'POST', 'callback' => [ $this, 'api_peg_pass' ], 'permission_callback' => '__return_true',
        ]);
        register_rest_route( $ns, '/count', [
            'methods' => 'POST', 'callback' => [ $this, 'api_count' ], 'permission_callback' => '__return_true',
        ]);
    }

    // ── Shortcode & Assets ──

    public function render_shortcode() {
        return '<div id="bella-cribbage-app"></div>';
    }

    public function maybe_enqueue() {
        if ( ! is_page( 'cribbage' ) ) return;
        wp_enqueue_script(
            'bella-cribbage',
            BELLA_SITE_URL . 'assets/js/cribbage.js',
            [],
            BELLA_SITE_VERSION,
            true
        );
        wp_localize_script( 'bella-cribbage', 'BellaCribbage', [
            'api'   => rest_url( 'bella/v1/cribbage/' ),
            'nonce' => wp_create_nonce( 'wp_rest' ),
        ]);
    }

    // ── API Handlers ──

    public function api_new( $request ) {
        $game_id = wp_generate_uuid4();
        $deck = $this->make_deck();
        shuffle( $deck );

        $player_hand = array_splice( $deck, 0, 6 );
        $bella_hand  = array_splice( $deck, 0, 6 );
        $dealer = random_int(0,1) ? 'player' : 'bella';

        $state = [
            'game_id'      => $game_id,
            'deck'         => $deck,
            'player_hand'  => $player_hand,
            'bella_hand'   => $bella_hand,
            'player_keep'  => [],
            'bella_keep'   => [],
            'crib'         => [],
            'starter'      => null,
            'player_score' => 0,
            'bella_score'  => 0,
            'dealer'       => $dealer,
            'phase'        => 'discard',
            'peg_played'   => [],
            'peg_count'    => 0,
            'peg_turn'     => '',
            'peg_player_hand' => [],
            'peg_bella_hand'  => [],
            'peg_player_go'   => false,
            'peg_bella_go'    => false,
            'message'      => '',
            'score_details'=> [],
            'created'      => time(),
        ];

        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_state( $request ) {
        $game_id = $request->get_param( 'game_id' );
        $state = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_discard( $request ) {
        $params  = $request->get_json_params();
        $game_id = $params['game_id'] ?? '';
        $cards   = $params['cards'] ?? [];
        $state   = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        if ( $state['phase'] !== 'discard' ) return new WP_Error( 'bad_phase', 'Not in discard phase', [ 'status' => 400 ] );
        if ( count( $cards ) !== 2 ) return new WP_Error( 'bad_input', 'Must discard exactly 2 cards', [ 'status' => 400 ] );

        // Validate cards are in player hand
        $player_hand = $state['player_hand'];
        $keep = [];
        $discarded = [];
        foreach ( $player_hand as $card ) {
            $cid = $card['rank'] . $card['suit'];
            if ( in_array( $cid, $cards ) && count( $discarded ) < 2 ) {
                $discarded[] = $card;
                $cards = array_values( array_diff( $cards, [ $cid ] ) );
            } else {
                $keep[] = $card;
            }
        }
        if ( count( $discarded ) !== 2 ) return new WP_Error( 'bad_cards', 'Cards not in hand', [ 'status' => 400 ] );

        $state['player_keep'] = $keep;
        $state['crib'] = array_merge( $state['crib'], $discarded );

        // Bella discards
        $bella_keep = $this->ai_choose_discards( $state['bella_hand'], $state['dealer'] === 'bella' );
        $bella_discard = [];
        foreach ( $state['bella_hand'] as $card ) {
            $found = false;
            foreach ( $bella_keep as $k ) {
                if ( $k['rank'] === $card['rank'] && $k['suit'] === $card['suit'] ) { $found = true; break; }
            }
            if ( ! $found ) $bella_discard[] = $card;
        }
        $state['bella_keep'] = $bella_keep;
        $state['crib'] = array_merge( $state['crib'], $bella_discard );

        // Cut starter
        $state['starter'] = array_shift( $state['deck'] );
        $msg = '';

        // His heels
        if ( $state['starter']['rank'] === 'J' ) {
            $who = $state['dealer'];
            $state[ $who . '_score' ] = min( $state[ $who . '_score' ] + 2, self::WIN_SCORE );
            $msg = 'His Heels! ' . ( $who === 'player' ? 'You' : 'Bella' ) . ' scores 2!';
            if ( $state['player_score'] >= self::WIN_SCORE || $state['bella_score'] >= self::WIN_SCORE ) {
                $state['phase'] = 'gameover';
                $state['message'] = $msg;
                $this->save_state( $game_id, $state );
                return rest_ensure_response( $this->public_state( $state ) );
            }
        }

        // Start pegging
        $state['phase'] = 'pegging';
        $state['peg_count'] = 0;
        $state['peg_played'] = [];
        $state['peg_player_hand'] = $state['player_keep'];
        $state['peg_bella_hand'] = $state['bella_keep'];
        $state['peg_player_go'] = false;
        $state['peg_bella_go'] = false;
        // Non-dealer plays first
        $state['peg_turn'] = ( $state['dealer'] === 'player' ) ? 'bella' : 'player';
        $state['message'] = $msg;
        $state['score_details'] = [];

        // If Bella goes first, auto-play
        if ( $state['peg_turn'] === 'bella' ) {
            $state = $this->bella_peg_turn( $state );
        }

        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_peg( $request ) {
        $params  = $request->get_json_params();
        $game_id = $params['game_id'] ?? '';
        $card_id = $params['card'] ?? '';
        $state   = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        if ( $state['phase'] !== 'pegging' ) return new WP_Error( 'bad_phase', 'Not in pegging phase', [ 'status' => 400 ] );
        if ( $state['peg_turn'] !== 'player' ) return new WP_Error( 'not_turn', 'Not your turn', [ 'status' => 400 ] );

        // Find card in player peg hand
        $card = null;
        $idx = -1;
        foreach ( $state['peg_player_hand'] as $i => $c ) {
            if ( $c['rank'] . $c['suit'] === $card_id ) { $card = $c; $idx = $i; break; }
        }
        if ( ! $card ) return new WP_Error( 'bad_card', 'Card not in hand', [ 'status' => 400 ] );
        if ( $state['peg_count'] + self::RANK_VALUES[ $card['rank'] ] > 31 ) {
            return new WP_Error( 'over_31', 'Would exceed 31', [ 'status' => 400 ] );
        }

        array_splice( $state['peg_player_hand'], $idx, 1 );
        $state['peg_played'][] = $card;
        $state['peg_count'] += self::RANK_VALUES[ $card['rank'] ];
        $state['peg_player_go'] = false;
        $state['peg_bella_go'] = false;

        $sc = $this->score_pegging( $state['peg_played'], $state['peg_count'] );
        $msg = 'You play ' . $card['rank'] . $card['suit'] . ' (count: ' . $state['peg_count'] . ')';
        if ( $sc['points'] > 0 ) {
            $state['player_score'] = min( $state['player_score'] + $sc['points'], self::WIN_SCORE );
            $msg .= ' — Peg ' . $sc['points'] . '! (' . implode(', ', $sc['details']) . ')';
        }
        $state['message'] = $msg;
        $state['score_details'] = $sc['details'];

        if ( $state['player_score'] >= self::WIN_SCORE ) {
            $state['phase'] = 'gameover';
            $this->save_state( $game_id, $state );
            return rest_ensure_response( $this->public_state( $state ) );
        }

        if ( $state['peg_count'] === 31 ) {
            $state = $this->reset_peg_count( $state );
        }

        // Advance to Bella
        $state = $this->advance_peg( $state, 'bella' );

        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_peg_pass( $request ) {
        $params  = $request->get_json_params();
        $game_id = $params['game_id'] ?? '';
        $state   = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        if ( $state['phase'] !== 'pegging' ) return new WP_Error( 'bad_phase', 'Not in pegging phase', [ 'status' => 400 ] );
        if ( $state['peg_turn'] !== 'player' ) return new WP_Error( 'not_turn', 'Not your turn', [ 'status' => 400 ] );

        $state['peg_player_go'] = true;
        $state['message'] = 'You say "Go"';

        // If Bella also can't play
        if ( $state['peg_bella_go'] || ! $this->can_play( $state['peg_bella_hand'], $state['peg_count'] ) ) {
            // Last card
            if ( $state['peg_count'] > 0 && $state['peg_count'] < 31 && ! empty( $state['peg_played'] ) ) {
                // Last card goes to whoever played last - figure out who
                $state = $this->award_last_card( $state, 'player' );
            }
            $state = $this->reset_peg_count( $state );
            $state = $this->advance_peg_after_reset( $state );
        } else {
            $state = $this->advance_peg( $state, 'bella' );
        }

        $this->save_state( $game_id, $state );
        return rest_ensure_response( $this->public_state( $state ) );
    }

    public function api_count( $request ) {
        $params  = $request->get_json_params();
        $game_id = $params['game_id'] ?? '';
        $state   = $this->load_state( $game_id );
        if ( ! $state ) return new WP_Error( 'not_found', 'Game not found', [ 'status' => 404 ] );
        if ( $state['phase'] !== 'counting' && $state['phase'] !== 'pegging' ) {
            return new WP_Error( 'bad_phase', 'Not ready for counting', [ 'status' => 400 ] );
        }

        $state['phase'] = 'counting';
        $results = [];

        // Non-dealer counts first
        if ( $state['dealer'] === 'player' ) {
            $order = [
                [ 'who' => 'bella',  'hand' => $state['bella_keep'],  'label' => "Bella's Hand", 'is_crib' => false ],
                [ 'who' => 'player', 'hand' => $state['player_keep'], 'label' => 'Your Hand',    'is_crib' => false ],
                [ 'who' => 'player', 'hand' => $state['crib'],        'label' => 'Your Crib',    'is_crib' => true  ],
            ];
        } else {
            $order = [
                [ 'who' => 'player', 'hand' => $state['player_keep'], 'label' => 'Your Hand',    'is_crib' => false ],
                [ 'who' => 'bella',  'hand' => $state['bella_keep'],  'label' => "Bella's Hand", 'is_crib' => false ],
                [ 'who' => 'bella',  'hand' => $state['crib'],        'label' => "Bella's Crib", 'is_crib' => true  ],
            ];
        }

        $game_over = false;
        foreach ( $order as $item ) {
            $score = $this->score_hand( $item['hand'], $state['starter'], $item['is_crib'] );
            $results[] = [
                'label'   => $item['label'],
                'who'     => $item['who'],
                'hand'    => $item['hand'],
                'points'  => $score['points'],
                'details' => $score['details'],
            ];
            if ( ! $game_over ) {
                $state[ $item['who'] . '_score' ] = min( $state[ $item['who'] . '_score' ] + $score['points'], self::WIN_SCORE );
                if ( $state['player_score'] >= self::WIN_SCORE || $state['bella_score'] >= self::WIN_SCORE ) {
                    $game_over = true;
                }
            }
        }

        if ( $game_over ) {
            $state['phase'] = 'gameover';
        } else {
            // Prepare for next round
            $state['phase'] = 'round_over';
        }

        $state['count_results'] = $results;
        $state['message'] = 'Counting complete.';
        $this->save_state( $game_id, $state );

        $pub = $this->public_state( $state );
        $pub['count_results'] = $results;
        return rest_ensure_response( $pub );
    }

    // ── Pegging helpers ──

    private function bella_peg_turn( $state ) {
        if ( $state['phase'] !== 'pegging' || $state['peg_turn'] !== 'bella' ) return $state;

        $card = $this->ai_choose_peg_card( $state['peg_bella_hand'], $state['peg_count'], $state['peg_played'] );
        if ( ! $card ) {
            // Bella says go
            $state['peg_bella_go'] = true;
            $state['message'] .= "\nBella says \"Go\"";

            if ( $state['peg_player_go'] || ! $this->can_play( $state['peg_player_hand'], $state['peg_count'] ) ) {
                if ( $state['peg_count'] > 0 && $state['peg_count'] < 31 ) {
                    $state = $this->award_last_card( $state, 'bella' );
                }
                $state = $this->reset_peg_count( $state );
                $state = $this->advance_peg_after_reset( $state );
            } else {
                $state['peg_turn'] = 'player';
            }
            return $state;
        }

        // Remove card from bella's hand
        foreach ( $state['peg_bella_hand'] as $i => $c ) {
            if ( $c['rank'] === $card['rank'] && $c['suit'] === $card['suit'] ) {
                array_splice( $state['peg_bella_hand'], $i, 1 );
                break;
            }
        }

        $state['peg_played'][] = $card;
        $state['peg_count'] += self::RANK_VALUES[ $card['rank'] ];
        $state['peg_player_go'] = false;
        $state['peg_bella_go'] = false;

        $sc = $this->score_pegging( $state['peg_played'], $state['peg_count'] );
        $state['message'] .= "\nBella plays " . $card['rank'] . $card['suit'] . ' (count: ' . $state['peg_count'] . ')';
        if ( $sc['points'] > 0 ) {
            $state['bella_score'] = min( $state['bella_score'] + $sc['points'], self::WIN_SCORE );
            $state['message'] .= ' — Pegs ' . $sc['points'] . '! (' . implode(', ', $sc['details']) . ')';
        }

        if ( $state['bella_score'] >= self::WIN_SCORE ) {
            $state['phase'] = 'gameover';
            return $state;
        }

        if ( $state['peg_count'] === 31 ) {
            $state = $this->reset_peg_count( $state );
        }

        // Check if pegging done
        if ( empty( $state['peg_player_hand'] ) && empty( $state['peg_bella_hand'] ) ) {
            if ( $state['peg_count'] > 0 && $state['peg_count'] < 31 ) {
                $state = $this->award_last_card( $state, 'bella' );
            }
            $state['phase'] = 'counting';
            $state['peg_turn'] = '';
            return $state;
        }

        $state['peg_turn'] = 'player';

        // If player can't play, auto-handle
        if ( ! $this->can_play( $state['peg_player_hand'], $state['peg_count'] ) ) {
            if ( empty( $state['peg_player_hand'] ) ) {
                // Player has no cards, Bella keeps going
                $state['peg_turn'] = 'bella';
                $state = $this->bella_peg_turn( $state );
            }
            // Otherwise player needs to say Go via the UI
        }

        return $state;
    }

    private function advance_peg( $state, $next ) {
        // Check if pegging is done
        if ( empty( $state['peg_player_hand'] ) && empty( $state['peg_bella_hand'] ) ) {
            if ( $state['peg_count'] > 0 && $state['peg_count'] < 31 ) {
                // Last card to whoever played last
                $last_played = end( $state['peg_played'] );
                // We don't track who played what in peg_played, use context
                // The person who just played gets last card
                $last_who = ( $next === 'bella' ) ? 'player' : 'bella';
                $state[ $last_who . '_score' ] = min( $state[ $last_who . '_score' ] + 1, self::WIN_SCORE );
                $state['message'] .= "\n" . ( $last_who === 'player' ? 'You' : 'Bella' ) . ' gets last card for 1.';
                if ( $state['player_score'] >= self::WIN_SCORE || $state['bella_score'] >= self::WIN_SCORE ) {
                    $state['phase'] = 'gameover';
                    return $state;
                }
            }
            $state['phase'] = 'counting';
            $state['peg_turn'] = '';
            return $state;
        }

        // Skip if next has no cards
        if ( $next === 'player' && empty( $state['peg_player_hand'] ) ) {
            $state['peg_turn'] = 'bella';
            return $this->bella_peg_turn( $state );
        }
        if ( $next === 'bella' && empty( $state['peg_bella_hand'] ) ) {
            $state['peg_turn'] = 'player';
            return $state;
        }

        $state['peg_turn'] = $next;
        if ( $next === 'bella' ) {
            $state = $this->bella_peg_turn( $state );
        }
        return $state;
    }

    private function advance_peg_after_reset( $state ) {
        if ( empty( $state['peg_player_hand'] ) && empty( $state['peg_bella_hand'] ) ) {
            $state['phase'] = 'counting';
            $state['peg_turn'] = '';
            return $state;
        }

        // Non-dealer goes first after reset, or whoever has cards
        if ( ! empty( $state['peg_player_hand'] ) && ! empty( $state['peg_bella_hand'] ) ) {
            $next = ( $state['dealer'] === 'player' ) ? 'bella' : 'player';
        } elseif ( ! empty( $state['peg_player_hand'] ) ) {
            $next = 'player';
        } else {
            $next = 'bella';
        }

        $state['peg_turn'] = $next;
        if ( $next === 'bella' ) {
            $state = $this->bella_peg_turn( $state );
        }
        return $state;
    }

    private function award_last_card( $state, $last_who ) {
        $state[ $last_who . '_score' ] = min( $state[ $last_who . '_score' ] + 1, self::WIN_SCORE );
        $state['message'] .= "\n" . ( $last_who === 'player' ? 'You' : 'Bella' ) . ' gets Go for 1.';
        if ( $state['player_score'] >= self::WIN_SCORE || $state['bella_score'] >= self::WIN_SCORE ) {
            $state['phase'] = 'gameover';
        }
        return $state;
    }

    private function reset_peg_count( $state ) {
        $state['peg_count'] = 0;
        $state['peg_played'] = [];
        $state['peg_player_go'] = false;
        $state['peg_bella_go'] = false;
        return $state;
    }

    private function can_play( $hand, $count ) {
        foreach ( $hand as $card ) {
            if ( $count + self::RANK_VALUES[ $card['rank'] ] <= 31 ) return true;
        }
        return false;
    }

    // ── Scoring ──

    private function score_hand( $hand, $starter, $is_crib = false ) {
        $all = array_merge( $hand, [ $starter ] );
        $fifteens = $this->score_fifteens( $all );
        $pairs    = $this->score_pairs( $all );
        $runs     = $this->score_runs( $all );
        $flush    = $this->score_flush( $hand, $starter, $is_crib );
        $nobs     = $this->score_nobs( $hand, $starter );

        $points = $fifteens['points'] + $pairs['points'] + $runs['points'] + $flush['points'] + $nobs['points'];
        $details = array_merge( $fifteens['details'], $pairs['details'], $runs['details'], $flush['details'], $nobs['details'] );

        return [ 'points' => $points, 'details' => $details ];
    }

    private function score_fifteens( $cards ) {
        $points = 0; $details = [];
        $n = count( $cards );
        for ( $k = 2; $k <= $n; $k++ ) {
            foreach ( $this->combinations( $cards, $k ) as $combo ) {
                $sum = 0;
                foreach ( $combo as $c ) $sum += self::RANK_VALUES[ $c['rank'] ];
                if ( $sum === 15 ) {
                    $points += 2;
                    $names = array_map( fn($c) => $c['rank'].$c['suit'], $combo );
                    $details[] = '15 for 2 (' . implode('+', $names) . ')';
                }
            }
        }
        return [ 'points' => $points, 'details' => $details ];
    }

    private function score_pairs( $cards ) {
        $points = 0; $details = [];
        foreach ( $this->combinations( $cards, 2 ) as $combo ) {
            if ( $combo[0]['rank'] === $combo[1]['rank'] ) {
                $points += 2;
                $details[] = 'Pair ' . $combo[0]['rank'].$combo[0]['suit'] . ',' . $combo[1]['rank'].$combo[1]['suit'] . ' for 2';
            }
        }
        return [ 'points' => $points, 'details' => $details ];
    }

    private function score_runs( $cards ) {
        $n = count( $cards );
        for ( $len = $n; $len >= 3; $len-- ) {
            $found = [];
            foreach ( $this->combinations( $cards, $len ) as $combo ) {
                $orders = array_map( fn($c) => self::RANK_ORDER[ $c['rank'] ], $combo );
                sort( $orders );
                $is_run = true;
                for ( $i = 1; $i < count($orders); $i++ ) {
                    if ( $orders[$i] !== $orders[$i-1] + 1 ) { $is_run = false; break; }
                }
                if ( $is_run ) $found[] = $combo;
            }
            if ( ! empty( $found ) ) {
                $points = 0; $details = [];
                foreach ( $found as $combo ) {
                    $points += count( $combo );
                    $names = array_map( fn($c) => $c['rank'].$c['suit'], $combo );
                    $details[] = 'Run of ' . count($combo) . ' (' . implode(',', $names) . ') for ' . count($combo);
                }
                return [ 'points' => $points, 'details' => $details ];
            }
        }
        return [ 'points' => 0, 'details' => [] ];
    }

    private function score_flush( $hand, $starter, $is_crib ) {
        if ( count( $hand ) < 4 ) return [ 'points' => 0, 'details' => [] ];
        $suit = $hand[0]['suit'];
        foreach ( $hand as $c ) {
            if ( $c['suit'] !== $suit ) return [ 'points' => 0, 'details' => [] ];
        }
        if ( $starter['suit'] === $suit ) {
            return [ 'points' => 5, 'details' => ['Flush of 5 for 5'] ];
        }
        if ( $is_crib ) return [ 'points' => 0, 'details' => [] ];
        return [ 'points' => 4, 'details' => ['Flush of 4 for 4'] ];
    }

    private function score_nobs( $hand, $starter ) {
        foreach ( $hand as $c ) {
            if ( $c['rank'] === 'J' && $c['suit'] === $starter['suit'] ) {
                return [ 'points' => 1, 'details' => ['Nobs (J' . $starter['suit'] . ') for 1'] ];
            }
        }
        return [ 'points' => 0, 'details' => [] ];
    }

    private function score_pegging( $played, $count ) {
        $points = 0; $details = [];
        $n = count( $played );
        if ( $n === 0 ) return [ 'points' => 0, 'details' => [] ];

        if ( $count === 15 ) { $points += 2; $details[] = 'Fifteen for 2'; }
        if ( $count === 31 ) { $points += 2; $details[] = '31 for 2'; }

        // Pairs
        if ( $n >= 2 ) {
            $last_rank = $played[$n-1]['rank'];
            $pair_count = 0;
            for ( $i = $n - 1; $i >= 0; $i-- ) {
                if ( $played[$i]['rank'] === $last_rank ) $pair_count++;
                else break;
            }
            if ( $pair_count === 2 ) { $points += 2; $details[] = 'Pair for 2'; }
            elseif ( $pair_count === 3 ) { $points += 6; $details[] = 'Three of a kind for 6'; }
            elseif ( $pair_count === 4 ) { $points += 12; $details[] = 'Four of a kind for 12'; }
        }

        // Runs
        if ( $n >= 3 ) {
            for ( $len = min($n, 7); $len >= 3; $len-- ) {
                $slice = [];
                for ( $i = $n - $len; $i < $n; $i++ ) $slice[] = self::RANK_ORDER[ $played[$i]['rank'] ];
                sort( $slice );
                $is_run = true;
                for ( $i = 1; $i < count($slice); $i++ ) {
                    if ( $slice[$i] !== $slice[$i-1] + 1 ) { $is_run = false; break; }
                }
                if ( $is_run ) { $points += $len; $details[] = "Run of $len for $len"; break; }
            }
        }

        return [ 'points' => $points, 'details' => $details ];
    }

    // ── AI ──

    private function ai_choose_discards( $hand, $is_dealer ) {
        $best_keep = null;
        $best_score = -999;

        foreach ( $this->combinations( $hand, 2 ) as $discard ) {
            $keep = [];
            foreach ( $hand as $card ) {
                $found = false;
                foreach ( $discard as $d ) {
                    if ( $card['rank'] === $d['rank'] && $card['suit'] === $d['suit'] ) { $found = true; break; }
                }
                if ( ! $found ) $keep[] = $card;
            }

            // Estimate hand score with random starters
            $total = 0;
            for ( $i = 0; $i < 6; $i++ ) {
                $fake = [ 'rank' => self::RANKS[ random_int(0,12) ], 'suit' => self::SUITS[ random_int(0,3) ] ];
                $total += $this->score_hand( $keep, $fake, false )['points'];
            }
            $avg = $total / 6;

            // Crib adjustment
            foreach ( $discard as $d ) {
                if ( $d['rank'] === '5' ) $avg += $is_dealer ? 2 : -2;
            }

            $avg += ( mt_rand(0, 100) / 100 - 0.5 ) * 2;

            if ( $avg > $best_score ) {
                $best_score = $avg;
                $best_keep = $keep;
            }
        }

        return $best_keep ?: array_slice( $hand, 0, 4 );
    }

    private function ai_choose_peg_card( $hand, $count, $played ) {
        $playable = array_filter( $hand, fn($c) => $count + self::RANK_VALUES[ $c['rank'] ] <= 31 );
        if ( empty( $playable ) ) return null;

        $best = null;
        $best_score = -1;
        foreach ( $playable as $card ) {
            $test_played = array_merge( $played, [ $card ] );
            $test_count = $count + self::RANK_VALUES[ $card['rank'] ];
            $sc = $this->score_pegging( $test_played, $test_count )['points'];
            $sc += mt_rand(0, 50) / 100;
            if ( $sc > $best_score ) { $best_score = $sc; $best = $card; }
        }
        return $best;
    }

    // ── Utilities ──

    private function make_deck() {
        $deck = [];
        foreach ( self::SUITS as $suit ) {
            foreach ( self::RANKS as $rank ) {
                $deck[] = [ 'rank' => $rank, 'suit' => $suit ];
            }
        }
        return $deck;
    }

    private function combinations( $arr, $k ) {
        $results = [];
        $arr = array_values( $arr );
        $n = count( $arr );
        if ( $k > $n ) return $results;

        $indices = range( 0, $k - 1 );
        $results[] = array_map( fn($i) => $arr[$i], $indices );

        while ( true ) {
            $i = $k - 1;
            while ( $i >= 0 && $indices[$i] === $i + $n - $k ) $i--;
            if ( $i < 0 ) break;
            $indices[$i]++;
            for ( $j = $i + 1; $j < $k; $j++ ) $indices[$j] = $indices[$j-1] + 1;
            $results[] = array_map( fn($i) => $arr[$i], $indices );
        }

        return $results;
    }

    private function save_state( $game_id, $state ) {
        update_option( 'bella_crib_' . $game_id, $state, false );
    }

    private function load_state( $game_id ) {
        if ( ! $game_id ) return null;
        $state = get_option( 'bella_crib_' . $game_id );
        return $state ?: null;
    }

    private function public_state( $state ) {
        $s = $state;
        // Don't expose bella's hand during discard, or bella's peg hand details
        $pub = [
            'game_id'      => $s['game_id'],
            'phase'        => $s['phase'],
            'dealer'       => $s['dealer'],
            'player_score' => $s['player_score'],
            'bella_score'  => $s['bella_score'],
            'starter'      => $s['starter'],
            'message'      => $s['message'] ?? '',
            'peg_count'    => $s['peg_count'],
            'peg_played'   => $s['peg_played'],
            'peg_turn'     => $s['peg_turn'],
        ];

        if ( $s['phase'] === 'discard' ) {
            $pub['player_hand'] = $s['player_hand'];
            $pub['bella_hand_count'] = count( $s['bella_hand'] );
        } else {
            $pub['player_keep'] = $s['player_keep'];
            $pub['bella_keep_count'] = count( $s['bella_keep'] ?? [] );
        }

        if ( $s['phase'] === 'pegging' ) {
            $pub['peg_player_hand'] = $s['peg_player_hand'];
            $pub['peg_bella_hand_count'] = count( $s['peg_bella_hand'] );
            $pub['peg_player_go'] = $s['peg_player_go'];
        }

        if ( $s['phase'] === 'counting' || $s['phase'] === 'round_over' || $s['phase'] === 'gameover' ) {
            $pub['player_keep'] = $s['player_keep'];
            $pub['bella_keep']  = $s['bella_keep'];
            $pub['crib']        = $s['crib'];
            if ( isset( $s['count_results'] ) ) $pub['count_results'] = $s['count_results'];
        }

        if ( $s['phase'] === 'gameover' ) {
            $pub['winner'] = $s['player_score'] >= self::WIN_SCORE ? 'player' : 'bella';
        }

        return $pub;
    }
}
