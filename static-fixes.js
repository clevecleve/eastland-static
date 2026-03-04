/**
 * static-fixes.js — Client-side interactivity patches for the static Eastlands site.
 *
 * This file is injected into every page by postprocess.js.
 * It handles interactions that the React app normally manages via state:
 *  - Mobile hamburger menu open/close
 *  - Desktop dropdown menus (click to open on touch/small screens)
 *  - Scroll-lock cleanup (noscroll class / top offset on <html>)
 *  - Search page: replace dead search box with a browse menu
 */
(function () {
  'use strict';

  // ── Scroll-lock cleanup ──────────────────────────────────────────────────────
  // React locks scroll by adding class="noscroll" and style="top:-Xpx" to <html>.
  // On a static site there's no React to undo this, so we do it on every load.
  function fixScrollLock() {
    var html = document.documentElement;
    html.classList.remove('noscroll');
    html.style.removeProperty('top');
    html.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
  }

  // ── Mobile hamburger menu ────────────────────────────────────────────────────
  function initHamburger() {
    // Try several common selectors used by Sitecore/QIC RE themes
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

        // Prevent body scroll while nav is open
        document.body.style.overflow = isOpen ? '' : 'hidden';
      });
    });
  }

  // ── Desktop dropdown menus ───────────────────────────────────────────────────
  function initDropdowns() {
    // Find items that have a nested ul/dropdown child
    var navItems = document.querySelectorAll(
      '.nav-item, .menu-item, [class*="nav__item"], [class*="menu__item"]'
    );

    navItems.forEach(function (item) {
      var dropdown = item.querySelector('ul, .dropdown, .submenu, [class*="dropdown"], [class*="submenu"]');
      if (!dropdown) return;

      var trigger = item.querySelector('a, button');
      if (!trigger) return;

      // On small screens / touch, toggle on click instead of hover
      trigger.addEventListener('click', function (e) {
        if (window.innerWidth >= 1024) return; // desktop uses CSS :hover
        e.preventDefault();
        var isOpen = item.classList.contains('is-open');
        // Close siblings
        if (item.parentElement) {
          item.parentElement.querySelectorAll(':scope > .nav-item.is-open, :scope > .menu-item.is-open').forEach(function (sibling) {
            if (sibling !== item) sibling.classList.remove('is-open');
          });
        }
        item.classList.toggle('is-open', !isOpen);
      });
    });

    // Close all dropdowns when clicking outside
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
  function initSearchPage() {
    var isSearchPage = /\/search/i.test(window.location.pathname);
    if (!isSearchPage) return;

    var searchBox = document.querySelector('.retailer-sitesearch, .site-search, [class*="search-form"], [class*="sitesearch"]');
    if (!searchBox) return;

    var notice = document.createElement('div');
    notice.className = 'sf-search-notice';
    notice.innerHTML = [
      '<div class="container">',
      '<p>Search is not available on this version of the site. Browse by section:</p>',
      '<p>',
      '<a href="/" class="btn-browse">Home</a>',
      '<a href="/Directory" class="btn-browse">Store Directory</a>',
      '<a href="/Eat" class="btn-browse">Eat &amp; Drink</a>',
      '<a href="/Events" class="btn-browse">Events &amp; Promotions</a>',
      '<a href="/Centre-Information" class="btn-browse">Centre Info</a>',
      '<a href="/Map" class="btn-browse">Centre Map</a>',
      '</p>',
      '</div>',
    ].join('\n');

    var parent = searchBox.closest('.base-component') || searchBox.parentElement;
    parent.insertBefore(notice, searchBox);
    searchBox.style.display = 'none';
  }

  // ── Back-to-top button ───────────────────────────────────────────────────────
  // Many QIC RE sites have a scroll-to-top button that only works via React state.
  // Wire it up directly.
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
