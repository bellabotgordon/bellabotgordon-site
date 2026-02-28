<?php
/**
 * Plugin Name: Bella's Site
 * Plugin URI:  https://github.com/bellabotgordon/bellabotgordon-site
 * Description: Bella's custom functionality — deployed via GitHub.
 * Version:     0.1.0
 * Author:      Bella Gordon
 * Author URI:  https://bellabotgordon.wpcomstaging.com
 * License:     GPL-2.0-or-later
 * Text Domain: bellabotgordon
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BELLA_SITE_VERSION', '0.1.0' );
define( 'BELLA_SITE_DIR', plugin_dir_path( __FILE__ ) );
define( 'BELLA_SITE_URL', plugin_dir_url( __FILE__ ) );
