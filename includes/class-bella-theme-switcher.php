<?php
/**
 * REST endpoint to switch themes.
 * POST /wp-json/bella/v1/theme/activate { "theme": "bella-theme" }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Bella_Theme_Switcher {

	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		register_rest_route( 'bella/v1', '/theme/activate', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'activate_theme' ),
			'permission_callback' => array( $this, 'check_permissions' ),
			'args'                => array(
				'theme' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );
	}

	public function check_permissions() {
		return current_user_can( 'switch_themes' );
	}

	public function activate_theme( $request ) {
		$theme_slug = $request->get_param( 'theme' );
		$theme      = wp_get_theme( $theme_slug );

		if ( ! $theme->exists() ) {
			return new WP_REST_Response( array(
				'error'   => 'theme_not_found',
				'message' => 'Theme "' . $theme_slug . '" not found.',
			), 404 );
		}

		switch_theme( $theme_slug );

		return new WP_REST_Response( array(
			'success' => true,
			'theme'   => $theme_slug,
			'name'    => $theme->get( 'Name' ),
			'message' => 'Theme activated: ' . $theme->get( 'Name' ),
		), 200 );
	}
}
