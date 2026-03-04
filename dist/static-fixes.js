/**
 * static-fixes.js — Client-side interactivity patches for QIC RE static sites.
 *
 * Injected into every page by postprocess-generic.js.
 * Handles interactions that the React app normally manages:
 *  - Mobile hamburger menu open/close
 *  - Desktop dropdown menus (click to open on touch/small screens)
 *  - Scroll-lock cleanup (noscroll class / top offset on <html>)
 *  - Search page: replace dead search box with a browse menu
 *  - Back-to-top button
 *
 * SITE-SPECIFIC: Update initSearchPage() browse links for each site.
 */
(function () {
  'use strict';

  // ── Scroll-lock cleanup ──────────────────────────────────────────────────────
  function fixScrollLock() {
    var html = document.documentElement;
    html.classList.remove('noscroll');
    html.style.removeProperty('top');
    html.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
  }

  // ── Mobile hamburger menu ────────────────────────────────────────────────────
  function initHamburger() {
    var triggers = document.querySelectorAll(
      '.hamburger, .nav-toggle, .mobile-menu-toggle, [data-toggle="mobile-nav"], ' +
      'button[aria-label*="menu" i], button[aria-label*="Menu"], ' +
      '.site-header__hamburger, .header__hamburger'
    );

    var nav = document.querySelector(
      '.mobile-nav, .nav-mobile, .mobile-menu, .navigation-mobile, ' +
      '.site-nav--mobile, .header-nav-mobile, [data-nav="mobile"]'
    );

    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var target = nav || document.querySelector(trigger.getAttribute('data-target') || '');
        if (!target) return;
        var isOpen = target.classList.contains('is-open') ||
                     target.classList.contains('open') ||
                     target.classList.contains('active');
        target.classList.toggle('is-open', !isOpen);
        target.classList.toggle('open', !isOpen);
        target.classList.toggle('active', !isOpen);
        trigger.classList.toggle('is-active', !isOpen);
        trigger.setAttribute('aria-expanded', String(!isOpen));
        document.body.style.overflow = isOpen ? '' : 'hidden';
      });
    });
  }

  // ── Desktop dropdown menus ───────────────────────────────────────────────────
  function initDropdowns() {
    var navItems = document.querySelectorAll(
      '.nav-item, .menu-item, [class*="nav__item"], [class*="menu__item"]'
    );

    navItems.forEach(function (item) {
      var dropdown = item.querySelector('ul, .dropdown, .submenu, [class*="dropdown"], [class*="submenu"]');
      if (!dropdown) return;
      var trigger = item.querySelector('a, button');
      if (!trigger) return;
      trigger.addEventListener('click', function (e) {
        if (window.innerWidth >= 1024) return;
        e.preventDefault();
        var isOpen = item.classList.contains('is-open');
        if (item.parentElement) {
          item.parentElement.querySelectorAll(':scope > .nav-item.is-open, :scope > .menu-item.is-open').forEach(function (sibling) {
            if (sibling !== item) sibling.classList.remove('is-open');
          });
        }
        item.classList.toggle('is-open', !isOpen);
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-item, .menu-item')) {
        document.querySelectorAll('.nav-item.is-open, .menu-item.is-open').forEach(function (el) {
          el.classList.remove('is-open');
        });
      }
    });
  }

  // ── Search page replacement ──────────────────────────────────────────────────
  // Sitecore site search won't work without the backend.
  // Replace the search box with a static browse menu.
  // NOTE: Update these links for each site's section structure.
  function initSearchPage() {
    var isSearchPage = /\/search/i.test(window.location.pathname);
    if (!isSearchPage) return;

    var searchBox = document.querySelector('.retailer-sitesearch, .site-search, [class*="search-form"], [class*="sitesearch"]');
    if (!searchBox) return;

    var siteLinks = window.SITE_BROWSE_LINKS || [
      ['/', 'Home'],
      ['/Directory', 'Store Directory'],
      ['/Eat', 'Eat &amp; Drink'],
      ['/Events', 'Events &amp; Promotions'],
      ['/Centre-Information', 'Centre Info'],
      ['/Map', 'Centre Map'],
    ];

    var notice = document.createElement('div');
    notice.className = 'sf-search-notice';
    notice.innerHTML = [
      '<div class="container">',
      '<p>Search is not available on this version of the site. Browse by section:</p>',
      '<p>',
      siteLinks.map(function (l) { return '<a href="' + l[0] + '" class="btn-browse">' + l[1] + '</a>'; }).join('\n'),
      '</p>',
      '</div>',
    ].join('\n');

    var parent = searchBox.closest('.base-component') || searchBox.parentElement;
    parent.insertBefore(notice, searchBox);
    searchBox.style.display = 'none';
  }

  // ── Back-to-top button ───────────────────────────────────────────────────────
  function initBackToTop() {
    var btn = document.querySelector('.back-to-top, [class*="back-to-top"], [aria-label*="top" i]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ── Run everything ───────────────────────────────────────────────────────────
  function init() {
    fixScrollLock();
    initHamburger();
    initDropdowns();
    initSearchPage();
    initBackToTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
