# Telsiz design system

[Türkçe](TASARIM.md) | [English](DESIGN.md)

Telsiz's interface is built on a single HTML structure and three visual themes. A theme only changes CSS tokens and theme specific decoration, the markup is the same in every theme. Arcade is the default theme, and on first launch the mode follows the system preference (dark when the system preference is unknown). This document covers the tokens, the themes, the layout, the components, the computed contrast ratios and the steps for adding a new theme.

## Files and load order

| File | Role |
| --- | --- |
| `public/theme-init.js` | Loaded in `<head>` without `defer`, before the stylesheets. Reads the saved preference and writes the root attributes, so the page paints with the right theme from the first frame. Defines the `window.TelsizTheme` interface. |
| `public/css/tokens.css` | Theme independent scales (spacing, type, target size, column widths, motion) plus the color, font and shape tokens of every theme and mode. The text size rules also live here. |
| `public/css/base.css` | Local fonts (`@font-face`, `font-display: swap`), reset, body and background glow, focus ring, scrollbars, icons, the reduce motion rule. |
| `public/css/layout.css` | App layout: member list, center area, channel column, drawers and breakpoints, the skeleton of the sign in screens. |
| `public/css/components.css` | Every component: button, input, select, switch, slider, card, tag, badge, avatar and status mark, menu, popover, modal, bottom sheet, tabs, list, empty state, toast, keycap, loading, messages, composer, emoji picker, profile card, home view and direct message parts. |
| `public/css/skins/arcade.css` | Arcade specific styling: glass panels, keycap lips, gradient edges, speaking halo, cabinet button. |
| `public/css/skins/gece.css` | Night Frequency specific styling: tuning dial and needle, frequency badges, LED status lights, equalizer, broadcast log feed. |
| `public/css/skins/turkuaz.css` | Turquoise and Copper specific styling: octagonal avatars, diamond status marks, star halo, border friezes, arched cards. |
| `public/fonts/` | Local woff2 fonts and their OFL license texts. |

`index.html` links the stylesheets in this order: tokens, base, layout, components, then the three theme files. Every rule in a theme file starts with `:root[data-skin="..."]`, so only the active theme applies, and loading all three files lets the theme switch instantly without a reload.

## Theme interface

`theme-init.js` exposes the interface below. The Settings > Appearance page and the app only use this interface.

| Member | Description |
| --- | --- |
| `TelsizTheme.get()` | Returns `{ skin, scheme, resolvedScheme, fontSize, compact, reduceMotion, motionReduced }`. `scheme` is the user's choice (`dark`, `light`, `system`), `resolvedScheme` is the applied mode (`dark` or `light`), `motionReduced` tells whether motion is currently reduced. |
| `TelsizTheme.set(partial)` | Validates the given fields, saves them on the device, updates the root attributes and calls the listeners. `reduceMotion` accepts `system`, `on`, `off` (or `true`, `false`). |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz']` |
| `TelsizTheme.onChange(fn)` | Adds a change listener and returns a function that removes it. Also called when the system color scheme or motion preference changes (only while "System" is selected). |

Root (`<html>`) attributes: `data-skin` (`arcade`, `gece`, `turkuaz`), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` (`true`, `false`), `data-reduce-motion` (`true`, `false`). The name `data-theme` is not used, because embedded preview frames write their own `data-theme` attribute on the root element.

Device storage keys: `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact`, `telsiz.reduceMotion`. When storage is blocked (private window) the choice lasts for the current session only.

Whenever the theme changes, `12-init.js` sets the `theme-color` meta tag to the active theme's `--theme-color` token and the `color-scheme` meta tag to the applied mode. The sun and moon button on the sign in screen (`#auth-scheme`) switches between dark and light. The manifest `theme_color` and `background_color` are the Arcade dark background (`#0f1015`), set by the server.

Text size: with `auto` the root font size is 16 px, 18 px from 1280 px wide and 22 px from 1800 px (TV and game consoles). `small` is 14, `normal` 16, `large` 18 and `tv` 22 pixels. All sizes are in `rem`, so the interface grows with the text size. In the compact view messages hide the avatar, the time sits on the left and the name shares one line with the text.

## Design tokens

Components never write color values, they only use the semantic tokens below. Every theme and mode defines all of these names.

Scales (theme independent):

| Token | Value | Use |
| --- | --- | --- |
| `--space-1` to `--space-8` | 0.25rem to 2rem | Spacing scale |
| `--target` | 2.75rem (44 px at a 16 px root) | Smallest touch and pointer target |
| `--text-xs` to `--text-2xl` | 0.75rem to 1.75rem | Type scale |
| `--members-width`, `--sidebar-width`, `--drawer-width` | 16rem, 17rem, 20rem | Column and drawer widths |
| `--dur-fast`, `--dur-med`, `--dur-slow`, `--ease` | 0.14s, 0.24s, 1.8s, `cubic-bezier(0.2, 0.7, 0.2, 1)` | Motion |

Surfaces and lines:

| Token | Meaning |
| --- | --- |
| `--bg`, `--bg-glow-a`, `--bg-glow-b` | Page background and the two soft lights behind it |
| `--surface-1` | Side columns (members, channels) |
| `--surface-1-glass` | Arcade's glass panel (only when `backdrop-filter` is supported) |
| `--surface-2` | Center area, message feed |
| `--surface-3` | Raised surface: active row, keycap, secondary button |
| `--surface-alt` | Cards, file card, voice lobby, message hover |
| `--surface-sunken` | Inputs, composer, meter track |
| `--surface-hover`, `--surface-active` | Hover and selected row |
| `--surface-float` | Menu, popover, profile card, dialog |
| `--overlay`, `--viewer-bg` | Drawer and modal scrim, image viewer background |
| `--line`, `--line-strong` | Decorative divider and card border |
| `--edge` | Border of interactive elements (at least 3:1) |

Text, accent and status:

| Token | Meaning |
| --- | --- |
| `--text`, `--text-2`, `--text-3` | Primary, secondary and muted text |
| `--link` | Link |
| `--accent`, `--accent-hover`, `--on-accent` | Primary fill, its hover and the text on it |
| `--accent-2` | Second accent (the second end of Arcade's gradient, the on air green in Night Frequency, copper in Turquoise and Copper) |
| `--accent-text`, `--accent-2-text` | Accent colored text on surfaces |
| `--accent-lip` | Bottom lip or ring of the primary button |
| `--accent-fill-a`, `--accent-fill-b` | Switch, meter and progress fill |
| `--attention`, `--on-attention` | Mention count and home total badge |
| `--mention-bg`, `--mention-text`, `--mention-line` | Mention pill and the highlight of messages that mention me |
| `--focus`, `--focus-halo` | Focus ring and its halo |
| `--ok`, `--idle`, `--dnd`, `--offline` | Status marks (component, 3:1) |
| `--live`, `--live-bg`, `--speaking-bg` | Connected voice, speaking person (also used as text, 4.5:1) |
| `--danger`, `--danger-bg`, `--danger-fill`, `--on-danger` | Danger text, background and fill |
| `--warn`, `--warn-bg`, `--warn-line` | Warning text, background and border |
| `--av-0` to `--av-7`, `--av-fg`, `--av-offline` | Eight avatar and profile colors, initial color, offline avatar fill. In Night Frequency each color has its own initial color (`--av-fg-0` to `--av-fg-7`). |
| `--theme-color` | Browser toolbar color |

Shape and type (vary by theme):

| Token | Arcade | Night Frequency | Turquoise and Copper |
| --- | --- | --- | --- |
| `--font-body` | Rubik | Manrope | Figtree |
| `--font-display` | Unbounded 700 | Manrope 800 | Young Serif 400 |
| `--font-label` | Unbounded, uppercase | Martian Mono, uppercase | Young Serif, sentence case |
| `--radius-panel` | 24px (floating panels) | 0 (flat panels) | 0 (flat panels) |
| `--radius-card`, `--radius-control` | 18px, 14px | 14px, 12px | 1.125rem, 0.75rem |
| `--avatar-radius` | 32% (cartridge) | 50% (circle) | octagonal tile (`clip-path`) |
| `--layout-pad`, `--column-gap` | 1rem, 0.875rem | 0, 0 | 0, 0 |

## Themes

**Arcade (default).** An arcade lobby. Glass panels floating on a charcoal background, keycap buttons with a bottom lip that sink when pressed, and a violet to cyan gradient reserved for small, meaningful surfaces (the edge of the active row, badges, send, the push to talk dome, the speaking halo). Cartridge shaped avatars, a domed push to talk button like a cabinet button, a segmented level meter and a small "arcade cursor" to the left of a focused list row. The light mode carries the same shape language into a lavender gray. The logo, favicon and app icons use the Arcade identity (a handheld radio silhouette with a gradient body and an arcade cabinet button).

**Night Frequency.** A radio station. A night blue background, amber signal as the single accent and on air green only for live things. The channel list is a tuning dial with a scale line and ticks, every channel has a frequency badge derived from its id (only visible in this theme and hidden from screen readers), and an amber needle marks the active channel. Status marks sit at the right end of member rows like LEDs on a device panel (full, half, bar, ring). The speaking person gets a green ring and equalizer bars, and the message feed shows times in a monospace column with a thin timeline.

**Turquoise and Copper.** The Anatolian tile and geometric pattern tradition. Turquoise means "place and trust", copper means "attention and voice aimed at you". Avatars are octagonal tiles, status marks are diamonds, the speaking person gets a breathing, turning eight pointed star, headers sit on a border frieze, the sign in card and the profile card are arched, text channels use a diamond tile instead of #, and push to talk is an asymmetric copper button. Text containing digits uses Figtree, because Young Serif has old style figures.

The speaking indicator looks different in every theme but is always driven by the same state class (`.is-speaking`). With reduce motion on, the halo, the equalizer and the star stay on a fully visible still frame, so no information is lost.

## Layout

On wide screens (1000 px and up) the member list (`#members`), the center area (`#main`) and the channel column (`#sidebar`) run from left to right. From top to bottom the channel column holds the server identity, the Home entry (`#home-entry`), direct messages (`#dm-section`, `#dm-list`), text channels, voice channels with their rosters, the voice connection panel and, at the bottom, the user panel with its controls.

At medium width (760 to 999 px) the channel column stays visible on the right and the member list becomes a layer that opens from the left. On narrow screens (below 760 px) only the center area is visible, the member drawer opens from the left and the channel drawer from the right. The header buttons follow suit: members at the top left, channels at the top right. On narrow screens, while connected to voice, a voice strip and (in push to talk mode) a push to talk pill appear above the composer, under the thumb.

The layout follows the markup order and never uses `dir` or `flex-direction: row-reverse`. Keyboard and screen reader order match the visual order. In the settings window the category list stays on the left.

Containers filled by other modules: `#home-view` (home view), `#dm-header` (direct message header), `#key-warning` (key changed strip), `#profile-card`, `#status-menu`, `#dialog-root` (safety number and identity unlock dialogs), `#typing-line` (typing line), `#btn-search` and `#search-panel` (search), `#mention-popover` (@ suggestions). The view mode lives in `#app-view[data-view]` (`channel`, `home`, `dm`).

## Components

| Component | Classes | Notes |
| --- | --- | --- |
| Button | `.button`, `.button-secondary`, `.button-ghost`, `.button-danger`, `.button-small`, `.button-wide`, `.icon-button` | At least 44 px. Keycap lip and primary gradient in Arcade. `.icon-button.is-off` for a muted microphone or deafened state. |
| Input and select | `.input`, `.select`, `.label`, `.hint`, `.form-error`, `.form-msg`, `.field-status` | Border uses `--edge` (3:1). |
| Check and switch | `.check`, `.switch` (`input` + `.switch-track`), `.segmented` | Diamond knob in Turquoise and Copper. |
| Slider and meter | `.range`, `.meter`, `.meter-bar`, `.meter-threshold`, `.password-strength` | Segmented in Arcade, LED segments in Night Frequency, tile cells in Turquoise and Copper. |
| Keycap | `.kbd` | Push to talk key and binding display. |
| Badge and tag | `.badge-owner`, `.badge-admin`, `.badge-active`, `.tag`, `.tag-ok`, `.tag-warn`, `.tag-danger` | |
| Unread and mention | `.unread-badge` (dot), `.mention-badge` (count), `.entry-badge` (home total) | Mention and total badges use `--attention`. |
| Avatar | `.avatar`, `.avatar-face`, `.avatar-img`, `.avatar-c0` to `.avatar-c7`, `.avatar-xs/-sm/-md/-lg/-xl` | Status mark through the `data-status` attribute (`online`, `idle`, `dnd`, `offline`), speaking through `.is-speaking`. `.status-dot` is a standalone status mark. |
| Card and list | `.card`, `.list-row`, `.list-main`, `.list-name`, `.list-sub`, `.empty-state`, `.empty-row` | |
| Loading | `.spinner`, `.typing-dots` | Three dots, still with reduce motion. |
| Tabs | `.tabs`, `.tab[aria-selected]` | |
| Notices | `.toast`, `.toast-error`, `.toast-ok`, `.conn-banner`, `.notice`, `.warning` | |
| Menu and popover | `.popup-menu`, `.menu-item`, `.menu-danger`, `.menu-separator`, `.popover`, `.status-option` | |
| Profile card | `.profile-card`, `.profile-card-band[data-color]`, `.profile-card-head`, `.profile-card-body`, `.profile-card-name`, `.profile-card-handle`, `.profile-card-status`, `.profile-card-section`, `.profile-card-bio`, `.profile-card-actions` | The color band follows the profile color. |
| Modal | `.modal`, `.modal-dialog`, `.app-dialog`, `.dialog`, `.dialog-actions`, `.sheet` | Full screen or bottom sheet on narrow screens. |
| Channel column | `.server-identity`, `.server-emblem`, `.home-entry`, `.channel-item`, `.dm-item`, `.voice-row`, `.voice-member`, `.voice-panel`, `.ptt-button`, `.user-panel` | `.channel-freq` frequency badge in Night Frequency. |
| Center area | `.channel-header`, `.channel-title`, `.dm-header`, `.key-warning`, `.search-panel`, `.home-view`, `.friend-row`, `.voice-strip`, `.ptt-pill` | |
| Messages | `.msg`, `.msg-first`, `.msg-author`, `.msg-text`, `.jumbo`, `.mention`, `.msg.is-mentioned`, `.msg-blocked`, `.file-card`, `.msg-image` | A message without its key has its own look in each theme (static noise, sunken card, wax seal). |
| Composer | `.composer`, `.composer-box`, `.tool-button`, `.send-button`, `.typing-line`, `.mention-popover`, `.mention-option` | The send icon depends on the theme (play triangle, up arrow, paper plane). |
| Emoji picker | `.emoji-picker`, `.emoji-tabs`, `.emoji-tab`, `.emoji-grid`, `.emoji-button`, `.is-sheet` | Bottom sheet on narrow screens. |
| Security | `.safety-number`, `.safety-group`, `.fingerprint`, `.verified-icon` | |

Theme specific decorative icons sit in the markup with the `.skin-arcade`, `.skin-gece` and `.skin-turkuaz` classes and only show in their own theme.

## State classes and JavaScript contract

All modules use the same state names: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` and `data-status`. Selected elements are also styled through `aria-current`, `aria-selected`, `aria-pressed` and `aria-checked`.

`avatar(userId, size)` in `02-state-dom.js` draws an avatar (`size`: `xs`, `sm`, `md`, `lg`, `xl`), and `fillAvatar(node, userId, size)` redraws an existing avatar element. Display name, `@username`, status and avatar data come from the `userDisplayName`, `userHandle`, `userStatus` and `userAvatarInfo` helpers in `13-profile.js`, with the username and its initial as a fallback. An avatar image is only shown when its address is a `blob:` URL. The channel and member lists are not redrawn when nothing changed, which keeps keyboard focus and the focus ring in place.

## Accessibility and contrast

The focus ring is part of the design: a 3 px `--focus` line with a translucent halo around it. Older browsers without `:focus-visible` get the same ring through `:focus`. Every button and field is at least 2.75rem tall (44 px at a 16 px root). Status is never shown by color alone, shape carries it too (full, crescent, bar, ring, and diamonds in Turquoise and Copper). The reduce motion option stops every transition and loop and can follow the system `prefers-reduced-motion` setting.

The table below shows, for each role, the lowest contrast ratio in that theme and mode. The ratios were computed by `scripts/kontrast.js` from the tokens in `public/css/tokens.css` with the WCAG 2.x relative luminance formula (text 4.5:1, interface component 3:1). Translucent surfaces were blended with the surface beneath them, and Arcade's glass panel was measured both over the plain background and over the brightest glow. All 626 measurements pass.

| Role | Minimum | Arcade dark | Arcade light | Night Frequency dark | Night Frequency light | Turquoise and Copper dark | Turquoise and Copper light |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Body text | 4.5:1 | 12.92 | 15.23 | 13.16 | 12.60 | 10.08 | 11.27 |
| Secondary text | 4.5:1 | 7.90 | 8.02 | 7.35 | 6.09 | 6.61 | 6.53 |
| Muted text (time, label, placeholder) | 4.5:1 | 5.57 | 5.76 | 5.50 | 4.83 | 4.85 | 4.81 |
| Accent text | 4.5:1 | 5.68 | 5.78 | 8.65 | 4.95 | 6.67 | 4.66 |
| Second accent text | 4.5:1 | 9.06 | 4.86 | 9.36 | 5.03 | 5.33 | 4.97 |
| Link | 4.5:1 | 10.40 | 5.78 | 9.56 | 5.48 | 7.95 | 5.20 |
| Live (connected, speaking) | 4.5:1 | 7.89 | 5.36 | 9.82 | 5.56 | 7.26 | 4.91 |
| Danger text | 4.5:1 | 5.09 | 5.00 | 6.64 | 5.02 | 4.71 | 4.72 |
| Warning text | 4.5:1 | 7.91 | 5.63 | 9.33 | 5.35 | 8.57 | 5.31 |
| Mention text | 4.5:1 | 8.14 | 7.58 | 9.33 | 5.35 | 6.60 | 5.64 |
| Text on accent fill | 4.5:1 | 5.25 | 5.25 | 10.47 | 9.21 | 7.11 | 5.41 |
| Text on gradient end (Arcade only) | 4.5:1 | 10.48 | 10.48 | n/a | n/a | n/a | n/a |
| Attention badge text | 4.5:1 | 5.25 | 5.25 | 10.47 | 9.21 | 6.65 | 4.82 |
| Text on danger fill | 4.5:1 | 8.37 | 6.67 | 8.49 | 6.66 | 7.06 | 6.53 |
| Input and card edge | 3:1 | 3.26 | 4.08 | 3.36 | 3.23 | 3.59 | 3.45 |
| Focus ring | 3:1 | 10.63 | 6.37 | 15.65 | 12.60 | 9.24 | 6.95 |
| Status: online | 3:1 | 9.47 | 6.21 | 10.35 | 3.41 | 7.83 | 5.65 |
| Status: idle | 3:1 | 9.50 | 4.60 | 9.56 | 3.32 | 8.58 | 5.03 |
| Status: do not disturb | 3:1 | 5.96 | 4.87 | 6.05 | 4.28 | 5.62 | 5.27 |
| Status: offline | 3:1 | 5.18 | 4.46 | 4.85 | 3.88 | 4.73 | 3.59 |
| Fill (send, switch, meter) | 3:1 | 4.56 | 4.88 | 9.89 | 3.92 | 6.63 | 4.36 |
| Fill second end | 3:1 | 9.10 | 3.39 | 9.89 | 3.92 | 6.63 | 4.36 |
| Avatar initial (8 colors) | 4.5:1 | 8.64 | 8.64 | 7.26 | 6.62 | 5.49 | 5.49 |
| Offline avatar initial | 4.5:1 | 7.49 | 10.02 | 7.66 | 6.27 | 5.98 | 5.10 |

## Adding a new theme

1. Pick a theme name (lowercase, for example `kumsal`) and add it to the `SKINS` list in `public/theme-init.js`.
2. In `public/css/tokens.css` add a `:root[data-skin="kumsal"]` block (fonts, radii, `--layout-pad`, `--column-gap`) and the `:root[data-skin="kumsal"][data-scheme="dark"]` and `:root[data-skin="kumsal"][data-scheme="light"]` blocks. Define every name listed under "Design tokens", a missing token falls back to the Arcade dark value.
3. Create `public/css/skins/kumsal.css` for theme specific styling. Every selector must start with `:root[data-skin="kumsal"]`, and the markup is not changed. Draw the speaking indicator through `.is-speaking` and status marks through `data-status`.
4. Link the file in `index.html` after the other theme files and add it to the cache list in `public/sw.js`. If you need a new font, put the woff2 file and its license under `public/fonts/` (name pattern `^[a-z0-9-]+\.woff2$`) and add an `@font-face` rule to `base.css` (`font-display: swap`, `unicode-range` for latin and latin-ext). The total font size must stay under 300 KB.
5. For the theme card in Settings > Appearance, add the `theme.skin.kumsal` and `theme.skinHint.kumsal` keys to `public/i18n.js` in Turkish and English, and define the `.theme-swatch-kumsal` preview colors in `components.css`.
6. Add the new theme to the `SKINS` and `SKIN_NAMES` lists in `scripts/kontrast.js` and run `node scripts/kontrast.js`. Adjust the colors until no pair fails, then update the table in this document with the output of `node scripts/kontrast.js --md`.
7. Open the app at 1920x1080, 1280x800 and 390x844 in dark and light mode and review the main screen, a voice channel, the emoji picker, the settings and the sign in screen. There must be no horizontal overflow, no unreadable text and no invisible focus ring.

## Older browser support

The stylesheets are written to also work in the older WebKit based browsers of game consoles. Layout uses only flexbox and margins. `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` and `inset` are not used. Animations and transforms also carry `-webkit-` prefixes. `backdrop-filter` is only used inside `@supports` and together with `-webkit-backdrop-filter`, when it is unsupported the panels fall back to the opaque `--surface-1` color and the contrast table holds for that fallback too. There are no inline styles or scripts (the content security policy blocks them), and icons come from the SVG sprite in `index.html` through `<use>` (with both `href` and `xlink:href`).
