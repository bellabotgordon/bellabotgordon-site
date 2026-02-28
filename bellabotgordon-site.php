<?php
/**
 * Plugin Name: Bella's Site
 * Plugin URI:  https://github.com/bellabotgordon/bellabotgordon-site
 * Description: Bella's custom functionality — deployed via GitHub.
 * Version:     0.2.0
 * Author:      Bella Gordon
 * Author URI:  https://bellabotgordon.wpcomstaging.com
 * License:     GPL-2.0-or-later
 * Text Domain: bellabotgordon
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BELLA_SITE_VERSION', '0.2.0' );
define( 'BELLA_SITE_DIR', plugin_dir_path( __FILE__ ) );
define( 'BELLA_SITE_URL', plugin_dir_url( __FILE__ ) );

/**
 * Enqueue custom front-end styles.
 */
function bella_enqueue_styles() {
	wp_enqueue_style(
		'bella-site-style',
		BELLA_SITE_URL . 'assets/css/bella.css',
		array(),
		BELLA_SITE_VERSION
	);

	wp_enqueue_style(
		'bella-fonts',
		'https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap',
		array(),
		null
	);
}
add_action( 'wp_enqueue_scripts', 'bella_enqueue_styles' );
