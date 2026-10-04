# Telsiz design system

[Türkçe](TASARIM.md) | [English](DESIGN.md)

The Telsiz interface is built on a single HTML structure, a layout called Frequency and three visual themes. The layout arranges the app like a radio dial: the frequencies you have joined (each a Telsiz server) sit as stations on a horizontal frequency band, the text and voice rooms of the open frequency are in the Stations list on the right, a single conversation column stands in the middle, and when you join a voice room a radio card that looks like a handheld radio opens. Themes change only CSS tokens and theme specific ornaments, and the markup never changes between themes. The default theme is Arcade, and on first start the mode follows the system preference (dark if unknown). This document describes the files, the layout, the breakpoints, the tokens, the themes, the components, the contrast measurements and the steps to add a new theme.

## Files and load order

| File | Purpose |
| --- | --- |
| `public/theme-init.js` | Loaded in `<head>` without `defer`, before the stylesheets. It reads the stored preference and writes the attributes of the root element, so the page opens with the right theme on first paint. It defines the `window.TelsizTheme` interface. |
| `public/css/tokens.css` | Theme independent scales (spacing, type, target size, motion), the measurements of the Frequency layout, the avatar shape, color, font and shape tokens for each theme and mode, and the font size rules. |
| `public/css/base.css` | Local fonts (`@font-face`, `font-display: swap`), reset, body and background glow, focus ring, scrollbars, icons, the reduced motion rule. |
| `public/css/frekans.css` | The core layout: the shell of the startup and identity screens, the top bar, the frequency band and frequency stations, the stage (left info column, conversation column, DJ column, right column), the Stations list, the radio card container, the frequency menu, side and bottom sheets, the TV hint bar, breakpoints. |
| `public/css/components.css` | General components: button, input, select, switch, slider, card, tag, badge, avatar and status marker, menu, popover, modal, tabs, list, notification, key cap, loading, message, emoji picker, profile card. |
| `public/css/settings.css` | The full screen settings view. |
| `public/css/chat-plus.css` | Search panel, @ mention badges and the suggestion list, typing line. |
| `public/css/convo.css` | The conversation column: header, message flow, empty, loading and error states, composer, suggestion list, search layer, inbox card. |
| `public/css/radio.css` | The radio card (screen, crew, Push to talk, button row), the per person volume popover and the avatar menu. |
| `public/css/people.css` | The sign in card, the On air sheet and strip, the direct message list and personal cards, the direct message header, the Friends station. |
| `public/css/cast.css` | Screen sharing: the live chip, share notice, broadcast stage, collapsed chat strip, share start dialog. |
| `public/css/dj.css` | The Telsiz DJ card, the Telsiz DJ item in the crew, the "Play in DJ" button in messages. |
| `public/css/skins/arcade.css`, `gece.css`, `turkuaz.css` | Theme specific styles. |
| `public/fonts/` | Local woff2 fonts and OFL license texts. |

`index.html` links the stylesheets in this order: tokens, base, frekans, components, settings, chat-plus, convo, radio, people, cast, dj, then the three theme files. Every rule in a theme file starts with `:root[data-skin="..."]`, so only the rules of the active theme apply. Loading all three files together makes theme switching instant without a page reload.

## Theme interface

`theme-init.js` provides the following interface. The Settings > Appearance page and the app use only this interface.

| Member | Description |
| --- | --- |
| `TelsizTheme.get()` | Returns the current preferences: theme (`skin`), chosen mode (`scheme`: `dark`, `light`, `system`), applied mode (`resolvedScheme`), font size, compact view and reduced motion. |
| `TelsizTheme.set(partial)` | Validates the given fields, stores them on the device, updates the root attributes and calls the listeners. |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz']` |
| `TelsizTheme.onChange(fn)` | Adds a change listener and returns a function that removes it. If "System" is selected, it is also called when the system mode changes. |

Root element (`<html>`) attributes: `data-skin` (`arcade`, `gece`, `turkuaz`), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` and `data-reduce-motion` (`true`, `false`). The keys on the device are `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact` and `telsiz.reduceMotion`. If storage is unavailable, the choice lasts only for that session.

`12-init.js` updates the `theme-color` meta tag to the `--theme-color` token of the active theme and the `color-scheme` meta tag to the applied mode every time the theme changes. With the `auto` font size, the root font size is 16 pixels, 18 pixels at 1280 pixels wide and up, and 22 pixels at 1800 pixels and up. `small` is 14, `normal` 16, `large` 18 and `tv` 22 pixels. All measurements use `rem`, so the interface grows with the font size.

## Frequency layout

The app screen (`#app-view`) consists of the following regions from top to bottom:

1. **Top bar (`#top`).** At the top left, the frequency switcher (`#frekans-button`: emblem, frequency name and a down arrow, with "Frequency · member count" and the encrypted note on the second line). Pressing it opens the menu of saved frequencies (`#frekans-menu`, `24-frekans.js`): the open frequency first and marked, switching to another, Add a frequency, Remove from list. In the middle, the Direct messages and Friends buttons (`#top-personal`, with badges for unread direct messages and pending requests). On the right, the Search chip, the On air strip (small avatars of online people, which opens the people list) and the avatar chip (`#me-button`, which opens the avatar menu: status, custom status, profile, settings, appearance, language, sign out). While you share your screen, the "Your screen is live" chip (`#top-cast`) shown on every station is also here. When the connection drops, a banner (`#conn-banner`) appears below the top bar.
2. **Frequency band (`#band`, `#band-track`).** The frequencies you have joined in a single row, with the "Frequencies" label at the start of the group (produced by `24-frekans.js`, drawn by `04-meta.js renderBand`). Each station is a frequency: an emblem with the first letter of its name and a status dot in its corner (the open frequency in the needle color, online green, offline red, sign-in needed yellow, unknown an empty ring), the name (the address if unknown), a second line with the status, the number of people online or the address, an inline unread badge and a mention badge in the corner (`@count`). The unread count is the total of rooms and direct messages, the mention count is the total of messages that mention you and direct messages. The band is one row high (`--band-h` 4rem): the scale strip and the needle knob on top, the 44 pixel stations below. The scale ticks scroll with the content, and the needle above a station shows the open frequency. Pressing another station, dragging the needle and dropping it on another station, the end buttons and the L1 and R1 buttons of a gamepad switch to that frequency, and while you are in a voice room you are asked first. The ends of the band hold previous and next frequency buttons, an Add a frequency button (+), a ? button that shows the guide to changing frequencies in a small popover (`#band-help`, `#hints-card`) and the All button that opens the Frequencies sheet. The band is a single tab stop on the keyboard (arrow keys move the focus, Home, End, Enter switches), and the wheel only scrolls the band horizontally and never changes the frequency. In the desktop app the status and unread counts of frequencies that are not open are shown too (background counting, [desktop/README.en.md](../desktop/README.en.md)). In the browser each frequency is a separate origin, so only the status and counts of the open frequency are shown, and the tooltip and accessible name of the other stations say so. In the browser the band order is carried in the address fragment, so it is the same on every frequency.
3. **Stage (`#stage`).** On wide screens from left to right: a narrow fixed left column (`#info-col`, `--side-left-w`: the conversation list and personal cards in the Direct view, and at the bottom of the column the radio card `#radio` with the card of the tuned station right below it), the conversation column that takes the remaining space (`#main`: header, messages, typing line, composer) and a narrow fixed right column (`#side-right`, `--side-right-w`: the list of text and voice rooms called Stations `#inbox`, with unread and mention badges, the number of people in a voice room, a speaking indicator and the Telsiz DJ note, and an Add room button `#inbox-add` in its header for owners and admins). Pressing a text room tunes it, pressing a voice room joins it. When the right column is not visible (below 999 pixels, below 1280 pixels on short screens, while the DJ column is open or while a screen share is live), the Stations button in the top bar (`#btn-rooms`, with a total unread badge) opens the same list in the Stations sheet. While Telsiz DJ is playing the DJ card (`#dj`) takes the place of the right column, and while a screen share is live the right column is hidden. Below 1280 pixels the radio card moves to the right column (`12-init.js placeRadio`).
4. **Broadcast stage (`#cast`).** While watching a screen share or previewing your own, the left and middle regions merge and the chat moves down into a collapsed strip.
5. **Sheets.** Frequencies (`#frekans-sheet`, the All button of the band: the frequencies with their status and counts, removing from the list and Add a frequency), Stations (`#stations-sheet`, text and voice rooms, Add room in the header), On air (`#people-sheet`) and, below 1280 pixels, Room info are side sheets that open from the right on wide screens and bottom sheets on phones. The up and down arrows, Home and End move between the rows of a sheet. Only one sheet is open at a time, and they share the `#drawer-backdrop` overlay.
6. **TV hint bar (`#tvbar`).** Appears at the bottom at 1800 pixels and up when a gamepad is detected.

The state of the radio card is in the `#radio[data-state]` attribute: `off` (not in a voice room, the screen lists voice rooms with Join buttons), `joining` (connecting), `on` (connected: room name, crew, talk line, Push to talk or the voice activity level bar, and the Microphone, Deafen, Screen and Leave buttons). The view mode is in the `#app-view[data-view]` attribute (`channel`, `home`, `dm`).

The layout follows the markup order, and `dir` or `flex-direction: row-reverse` are not used. Keyboard and screen reader order follows the visual order: top bar, band, left column, conversation, right column.

## Breakpoints

`12-init.js` writes the `#app-view[data-layout]` attribute according to the window width (`tv`, `wide`, `wide-narrow`, `medium`, `narrow`) and closes open sheets when the layout class changes. CSS applies the same limits with media queries.

| Name | Condition | What changes |
| --- | --- | --- |
| TV | `min-width: 1800px` | Root font 22 pixels (with the automatic font size), larger focus ring, hint bar when a gamepad is present, header row of the radio card hidden |
| Wide | `min-width: 1280px` | Three region stage: radio card and room info on the left, the conversation grows in the middle, Stations or the DJ card on the right |
| Wide narrow | 1000 to 1279 pixels | Left column hidden, radio card in the right column, personal buttons in the top bar as icons, room info in a side sheet from the header button, DJ card in a sheet opened from the Telsiz DJ item in the crew |
| Medium | `max-width: 999px` | Radio card 17rem, buttons in two rows, Stations card hidden, Stations button in the top bar (side sheet) |
| Narrow (phone) | `max-width: 759px` | The band runs edge to edge and scrolls with a finger, All button, only the emblem on the frequency button (the name is on the band), full width conversation, the radio card sticks to the bottom of the screen, layers (Stations included) open from the bottom |
| Short | `max-height: 860px` and below 1280 pixels | Stations card hidden, Stations button in the top bar |

## Design tokens

Components never write color values and use only semantic tokens. Every theme and mode defines all color tokens. The tokens of the Frequency layout refer only to theme tokens, so they get the right color in all three themes and both modes automatically.

Scales and layout (theme independent):

| Token | Value | Use |
| --- | --- | --- |
| `--space-1` to `--space-8` | 0.25rem to 2rem | Spacing scale |
| `--target` | 2.75rem (44 pixels at a 16 pixel root) | Smallest touch and pointer target |
| `--text-xs` to `--text-2xl` | 0.75rem to 1.75rem | Type scale |
| `--dur-fast`, `--dur-med`, `--dur-slow`, `--ease` | 0.14s, 0.24s, 1.8s, `cubic-bezier(0.2, 0.7, 0.2, 1)` | Motion |
| `--top-h` | 3.75rem (narrow 3.5rem) | Top bar height |
| `--band-h`, `--band-pad`, `--dial-top` | 4rem, 0.25rem, 0.125rem | Frequency band height, bottom padding, distance of the scale line from the top |
| `--station-h` | 2.75rem | Station height |
| `--column-max` | 46rem | Widest conversation column |
| `--side-w` | 17.5rem | DJ card in a side sheet |
| `--side-left-w`, `--side-right-w` | 19.5rem, 14.5rem | On wide screens the left column (radio card, room info) and the right column (Stations, DJ card) |
| `--radio-w` | 21rem (medium 17rem) | Below 1280 pixels the right column and the radio card |
| `--sheet-w` | 25rem | Side sheet width |
| `--avatar-radius` | `28%` | Avatar corner radius, in every theme |
| `--dot-radius` | `32%` | Status dot and corner markers |

Frequency color tokens:

| Token | Value | Meaning |
| --- | --- | --- |
| `--needle`, `--needle-knob` | `var(--accent)` | Needle line and knob |
| `--needle-ring` | `var(--surface-1)` | Knob ring |
| `--tick`, `--tick-major` | `var(--line-strong)`, `var(--edge)` | Scale ticks |
| `--band-bg` | `var(--surface-1)` | Band background |
| `--station-tuned-bg` | `var(--surface-3)` | Tuned station |
| `--station-target` | `var(--focus-halo)` | Target station while dragging the needle |
| `--radio-bg`, `--screen-bg` | `var(--surface-2)`, `var(--surface-sunken)` | Radio body and screen |

Surfaces and lines:

| Token | Meaning |
| --- | --- |
| `--bg`, `--bg-glow-a`, `--bg-glow-b` | Page background and the two soft glows behind it |
| `--surface-1`, `--surface-1-glass` | Band, column cards and the Arcade glass panel (only when `backdrop-filter` is supported) |
| `--surface-2` | Conversation column and radio body |
| `--surface-3` | Raised surface: tuned station, key cap, secondary button |
| `--surface-alt` | Cards, file card, message hover |
| `--surface-sunken` | Input, composer, radio screen, meter track |
| `--surface-hover`, `--surface-active` | Hover and selected row |
| `--surface-float` | Menu, popover, profile card, dialog |
| `--overlay`, `--viewer-bg` | Sheet and dialog overlay, image viewer background |
| `--line`, `--line-strong` | Decorative separator and card border |
| `--edge` | Border of interactive elements (at least 3:1) |

Text, accent and status:

| Token | Meaning |
| --- | --- |
| `--text`, `--text-2`, `--text-3`, `--text-strong` | Main, secondary, muted and emphasized text |
| `--link` | Link |
| `--accent`, `--accent-hover`, `--on-accent` | Primary accent, hover and text on the accent |
| `--accent-fill-a`, `--accent-fill-b`, `--on-accent-fill` | The gradient of Send, Push to talk and primary filled buttons, and the text on it. It is `--on-accent` in dark modes and white in light modes. |
| `--accent-2`, `--accent-text`, `--accent-2-text`, `--accent-lip` | Second accent (the second stop of the Arcade gradient, on air green in Gece, copper in Turkuaz), accent colored text on surfaces, the lip of the primary button |
| `--attention`, `--on-attention` | Mention count badge |
| `--mention-bg`, `--mention-text`, `--mention-line` | Mention badge and the highlight of messages that mention you |
| `--focus`, `--focus-halo` | Focus ring and its halo |
| `--ok`, `--idle`, `--dnd`, `--offline` | Status markers (component, 3:1) |
| `--live`, `--live-bg`, `--speaking-bg`, `--halo-1`, `--halo-2` | Connected voice, speaking person and the speaking halo |
| `--danger`, `--danger-bg`, `--danger-fill`, `--on-danger` | Danger text, background and fill |
| `--warn`, `--warn-bg`, `--warn-line` | Warning text, background and border |
| `--av-0` to `--av-7`, `--av-fg`, `--av-offline` | Eight avatar and profile colors, initial color, offline avatar fill. In the Gece theme each color has its own initial color (`--av-fg-0` to `--av-fg-7`). |
| `--theme-color` | Browser bar color |

Shape and type (they change per theme):

| Token | Arcade | Night Frequency (Gece) | Turquoise and Copper (Turkuaz) |
| --- | --- | --- | --- |
| `--font-body` | Rubik | Manrope | Figtree |
| `--font-display` | Unbounded 700 | Manrope 800 | Young Serif 400 |
| `--font-label` | Unbounded | Martian Mono | Young Serif |
| `--radius-panel` | 24px (floating panels) | 0 (flat panels) | 0 (flat panels) |
| `--radius-card`, `--radius-control` | 18px, 14px | 14px, 12px | 1.125rem, 0.75rem |
| `--layout-pad`, `--column-gap` | 1rem, 0.875rem | 0, 0 | 0, 0 |

## Themes

**Arcade (default).** An arcade lobby. Floating glass panels on a dark charcoal background, key cap buttons with a lip on their bottom edge that sink when pressed, and a purple to cyan gradient only on small, meaningful surfaces (the edge of the tuned station, badges, Send, the Push to talk dome, the speaking halo). A domed Push to talk button like an arcade cabinet button, a segmented level meter, and a small "arcade cursor" to the left of a focused list row. The light mode carries the same language to lavender grey. The logo, favicon and app icons use the Arcade identity.

**Night Frequency (Gece Frekansı).** A radio station. A night blue background, a single amber signal accent, and on air green only for things that are live. Flat panels and thin separators, the radio card on a console background. Rooms in the Stations list show a frequency badge derived from the room id (visible only in this theme). Status dots look like LEDs on a device panel. A green ring and equalizer bars on the speaking person, times in a monospaced column in the message flow, a knurled round Push to talk button and an ON AIR lamp.

**Turquoise and Copper (Turkuaz ve Bakır).** The tradition of tiles and geometric patterns. Turquoise means "place and trust", copper means "attention and sound directed at you". A frieze of diamond chains under headings, arch shaped emblem and cards, diamond patterned status fills, a breathing green halo on the speaking person, an asymmetric copper Push to talk button, and a copper sealed card for encrypted messages. Patterns sit only on edges and empty areas, and text always sits on a plain background. Text with digits uses Figtree, because the digits of Young Serif are old style.

The speaking indicator looks different in each theme but is always triggered by the same state class (`.is-speaking`). With reduced motion on, the halo, pulse, equalizer and typing dots stay still, and no information is lost. Theme specific ornament icons sit in the markup with the `.skin-arcade`, `.skin-gece` and `.skin-turkuaz` classes and are visible only in their own theme, for example the icon of the Send button.

## Avatar and status shape

All avatars are soft squares in all three themes, never circles: in the message flow, the crew of the radio card, the On air strip and sheet, the profile card, the avatar menu, friends, direct messages, suggestion lists and search results. The corner radius is set by `--avatar-radius: 28%`. Because the value is a percentage, the ratio is the same for a small stack avatar and a large profile avatar.

Status dots and corner markers (muted, deafened, sharing the screen) are soft squares of the same family (`--dot-radius: 32%`), sit on the bottom right corner of the avatar and are separated by a border in the background color. The speaking halo is drawn with `box-shadow`, so it follows the outside of the square frame. Telsiz DJ is not a real user: its avatar is a note icon with a dashed border and it carries a "bot" tag. The circles that remain are not avatars: the needle knob, the pulse dot, the LED, the Push to talk dome and radio selection dots.

## Components

| Component | Classes | Note |
| --- | --- | --- |
| Button | `.button`, `.button-secondary`, `.button-ghost`, `.button-danger`, `.button-small`, `.button-wide`, `.icon-button` | At least 44 pixels. Key cap lip and primary gradient in Arcade. |
| Input and select | `.input`, `.select`, `.label`, `.hint`, `.form-error`, `.form-msg`, `.field-status` | Border `--edge` (3:1). |
| Check and switch | `.check`, `.switch`, `.segmented` | Diamond knob in Turkuaz. |
| Slider and meter | `.range`, `.meter`, `.meter-bar`, `.meter-threshold` | Segmented in Arcade, LED segments in Gece, tiled in Turkuaz. |
| Key cap | `.kbd` | Push to talk key and binding display. |
| Badge and tag | `.badge-owner`, `.badge-admin`, `.tag`, `.unread-badge`, `.mention-badge` | The mention badge uses `--attention`. |
| Avatar | `.avatar`, `.avatar-face`, `.avatar-img`, `.avatar-c0` to `.avatar-c7`, `.avatar-xs`, `.avatar-sm`, `.avatar-md`, `.avatar-lg`, `.avatar-xl` | Status through the `data-status` attribute (`online`, `idle`, `dnd`, `offline`), speaking through `.is-speaking`. |
| Top bar | `.top-bar`, `.top-brand-button`, `.top-personal`, `.top-personal-button`, `.top-chip`, `.top-me`, `.top-stack` | Frequency switcher, personal buttons, Search, On air and avatar chips. |
| Frequency menu | `.frekans-menu`, `.frekans-row`, `.frekans-item`, `.frekans-emblem`, `.frekans-remove`, `.frekans-add` | The open frequency has `.is-active` and `aria-checked="true"`. |
| Frequency band | `.band-track`, `.band-step`, `.band-all`, `.station`, `.station-frekans`, `.station-emblem`, `.frekans-dot`, `.station-meta`, `.needle`, `.frekans-sheet-row` | Station states: `.is-tuned`, `.is-target`, `.is-unread`, `.is-mentioned` and the frequency status `.is-open`, `.is-online`, `.is-offline`, `.is-login`, `.is-unknown`. Needle: `.is-dragging`. |
| Left column and Stations | `.side-left`, `.info-bottom`, `.radio-slot`, `.facts`, `.hints`, `.hints-pop`, `.dm-section`, `.inbox`, `.inbox-head`, `.rooms-list`, `.room-row`, `.top-rooms` | Row states: `.is-current`, `.is-unread`, and for voice `.is-connected`, `.is-joining`, `.is-live`. |
| Conversation column | `.convo`, `.convo-head`, `.convo-title`, `.msg`, `.msg-skeleton`, `.channel-start`, `.typing-line`, `.mention-popover`, `.search-panel` | A message that mentions you gets the `--mention-bg` background and a left line. |
| Radio card | `.radio`, `.radio-screen`, `.crew-item`, `.crew-badge`, `.radio-talk`, `.radio-ptt`, `.radio-vad`, `.radio-button` | `.is-speaking` on crew items, `aria-pressed` on buttons. |
| Avatar menu | `.avatar-menu` | Status options are `menuitemradio`. |
| People | `.member`, `.home-view`, `.home-tab`, `.dm-header`, `.people-card` | The On air sheet, the Friends station, the direct message header. |
| Sign in card | `.auth-card`, `.auth-dial`, `.auth-needle` | A card shaped like a radio body. |
| Screen sharing | `.cast-panel`, `.cast-head`, `.cast-chip`, `.cast-video`, `.cast-dock-toggle`, `.top-cast-chip`, `.cast-preset` | `body[data-cast="live"]` while the stage is open. |
| Telsiz DJ | `.dj-card`, `.dj-yt`, `.dj-wave`, `.dj-ctrl`, `.dj-vol`, `.crew-dj` | The YouTube player area (`.dj-yt`) is always at least 200x200 CSS pixels regardless of font size, and nothing is drawn on top of it. |
| Settings | `.settings-view`, `.settings-cat`, `.settings-section`, `.settings-theme-card`, `.settings-switch` | The selected category is marked with a left line in the needle color. |
| Layers | `.popup-menu`, `.popover`, `.modal`, `.sheet`, `.toast`, `.conn-banner` | On narrow screens layers open from the bottom. |

## State classes and JavaScript contract

All modules use the same state names: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` and `data-status`. Selected items are also styled through `aria-current`, `aria-selected`, `aria-pressed` and `aria-checked`. Region states are carried in attributes: `#app-view[data-layout]`, `#app-view[data-view]`, `#radio[data-state]`, `body[data-cast]` and `body[data-cast-chat]`. When a gamepad is detected, the `.has-gamepad` class is added to `#app-view`.

`avatar(userId, size)` in `02-state-dom.js` draws an avatar (`size`: `xs`, `sm`, `md`, `lg`, `xl`), and `fillAvatar(node, userId, size)` redraws an existing avatar element. Display name, `@username`, status and avatar information come from helpers in `13-profile.js`. An avatar image is shown only if it is a `blob:` address. `04-meta.js` draws the band (its stations come from `24-frekans.js`) and `21-band.js` binds its interaction. Lists that have not changed are not redrawn, so keyboard focus is kept. Layers use the layer stack in `02-state-dom.js`: when opened, focus moves to the first meaningful element, Esc and an outside click close them, and focus returns to the button that opened them.

## Accessibility and contrast

The focus ring is part of the design: a 3 pixel `--focus` line with a semi transparent halo around it, thicker at TV width. In older browsers without `:focus-visible`, the same ring comes with `:focus`. All buttons and fields are at least 2.75rem tall (44 pixels at a 16 pixel root). States are distinguished not only by color but also by shape and text, and the accessible names of stations and crew items include the unread count and the connection and speaking state. The reduced motion option stops transitions and loops and can follow the system `prefers-reduced-motion` setting.

The table below shows the lowest contrast ratio for each role in each theme and mode. The ratios were computed from the tokens in `public/css/tokens.css` with the WCAG 2.x relative luminance formula (text 4.5:1, user interface component 3:1). Semi transparent surfaces were measured blended with the background beneath them, and the Arcade glass panel was measured both on the plain background and on the brightest glow point. The filled button text (`--on-accent-fill`) was measured on both stops of the gradient (`--accent-fill-a` and `--accent-fill-b`). All values in the table meet the threshold.

| Role | Threshold | Arcade dark | Arcade light | Night Frequency dark | Night Frequency light | Turquoise and Copper dark | Turquoise and Copper light |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Main text | 4.5:1 | 12.92 | 15.23 | 13.16 | 12.60 | 10.08 | 11.27 |
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
| Filled button text | 4.5:1 | 5.25 | 4.82 | 10.47 | 5.01 | 7.11 | 5.41 |
| Text on second gradient stop (Arcade only) | 4.5:1 | 10.48 | 10.48 | n/a | n/a | n/a | n/a |
| Attention badge text | 4.5:1 | 5.25 | 5.25 | 10.47 | 9.21 | 6.65 | 4.82 |
| Text on danger fill | 4.5:1 | 8.37 | 6.67 | 8.49 | 6.66 | 7.06 | 6.53 |
| Input and card border | 3:1 | 3.26 | 4.08 | 3.36 | 3.23 | 3.59 | 3.45 |
| Focus ring | 3:1 | 10.63 | 6.37 | 15.65 | 12.60 | 9.24 | 6.95 |
| Status: online | 3:1 | 9.47 | 6.21 | 10.35 | 3.41 | 7.83 | 5.65 |
| Status: idle | 3:1 | 9.50 | 4.60 | 9.56 | 3.32 | 8.58 | 5.03 |
| Status: do not disturb | 3:1 | 5.96 | 4.87 | 6.05 | 4.28 | 5.62 | 5.27 |
| Status: offline | 3:1 | 5.18 | 4.46 | 4.85 | 3.88 | 4.73 | 3.59 |
| Fill (send, switch, meter) | 3:1 | 4.56 | 4.88 | 9.89 | 3.92 | 6.63 | 4.36 |
| Fill second stop | 3:1 | 9.10 | 4.28 | 9.89 | 3.92 | 6.63 | 4.36 |
| Avatar initial (8 colors) | 4.5:1 | 8.64 | 8.64 | 7.26 | 6.62 | 5.49 | 5.49 |
| Offline avatar initial | 4.5:1 | 7.49 | 10.02 | 7.66 | 6.27 | 5.98 | 5.10 |

## Adding a new theme

1. Choose a name for the theme (lowercase, for example `kumsal`) and add it to the `SKINS` list in `public/theme-init.js`.
2. Add a `:root[data-skin="kumsal"]` block (fonts, radii, `--layout-pad`, `--column-gap`) and the `:root[data-skin="kumsal"][data-scheme="dark"]` and `:root[data-skin="kumsal"][data-scheme="light"]` blocks to `public/css/tokens.css`. Define all color names from the "Design tokens" section, including `--on-accent-fill`. A missing token falls back to the Arcade dark value. Do not change the Frequency tokens or `--avatar-radius`.
3. Create `public/css/skins/kumsal.css` for theme specific styles. Every selector must start with `:root[data-skin="kumsal"]`, and the markup is not changed. Draw the speaking indicator through `.is-speaking` and status markers through `data-status`, and keep the avatar shape.
4. Link the file in `index.html` after the other theme files and add it to the cache list in `public/sw.js`. If a new font is needed, put the woff2 file and its license under `public/fonts/` (file name in lowercase letters, digits and hyphens) and add an `@font-face` rule (`font-display: swap`) to `base.css`.
5. For the theme card in Settings > Appearance, add the `theme.skin.kumsal` and `theme.skinHint.kumsal` keys in Turkish and English to `public/i18n.js`, and define the `.theme-swatch-kumsal` preview colors in `components.css`.
6. Measure the contrast of all text and component pairs with the WCAG 2.x formula and add the new columns to the table above. No pair may stay below its threshold.
7. Open the app at 1920x1080, 1440x900, 1280x800, 900x800 and 390x844 in dark and light mode and review the band, a voice room, screen sharing, Telsiz DJ, the emoji picker, settings and the sign in screen. There must be no horizontal overflow, unreadable text or invisible focus ring.

## Older browser support

Stylesheets are written to work in the older WebKit based browsers of game consoles too. Layout uses only flexbox and margins. `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` and `inset` are not used. Animations and transforms are also written with `-webkit-` prefixes. `backdrop-filter` is used only inside `@supports` and together with `-webkit-backdrop-filter`, and when it is not supported the panels fall back to the opaque `--surface-1` color. The scale ticks of the band scroll with `background-attachment: local`, and in browsers without support only the decoration is lost. There are no inline styles or scripts (the Content Security Policy blocks them), and icons come from the SVG sprite in `index.html` through `<use>` (with both `href` and `xlink:href`).
