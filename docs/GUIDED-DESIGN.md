# Guided light workspace — 14 October 2026

The app previously opened on an empty YouTube digest and displayed the full tool catalog in its header. The redesign opens sign-in on a task-oriented Start page, with a light palette and a soft gradient inspired by the supplied https://lovable.dev/ reference. No Lovable assets, services or infrastructure are embedded.

## Everyday routes

1. Save a link on Start or Inbox. The existing capture action, learning default, validation and session guard remain in use.
2. Open Learn to process and review learning material. Saving is distinguished from generation; an AI provider is required for processing.
3. Choose the residency brand or property-listing script workflow. Existing brand IDs and routes are preserved.
4. Review drafts, then plan dates in Calendar. Publishing remains subject to the existing account and policy gates.

Home includes three keyboard-accessible task tabs and links to the video library, selected channels and calendar. Brand-family cards and their real weekly counts remain available in a collapsible portfolio overview. Contextual guidance appears on protected tool pages, showing the workflow position and a useful next destination. It does not automatically advance status or execute jobs.

## Navigation and appearance

Header groups: Start here; Save & learn; Create; Plan & publish; More tools. Existing destinations are preserved. Descriptions explain what each destination is for. Mobile navigation is expandable and scroll-bounded. Dropdowns support click/tap, Escape, outside-click and keyboard focus. New home/guidance copy follows the English/Swedish locale through server props, including capture labels. Sign-out and spend display remain available.

Shared design tokens now use light backgrounds, white cards, dark text and violet actions. Existing media overlays and the black filming teleprompter retain their intended dark presentation. Reduced-motion settings are respected for new transitions. No remote font or image dependencies were added.

The empty YouTube digest offers Import your first video and Just save a link, with an explanation of the sequence. It does not initiate ingestion or model calls just by being viewed.

## Scope and deployment

No schema changes, provider adapters, scheduling, account connections, live database changes, hosting writes or DNS changes are part of this redesign. The live site is not updated by editing the checkout. Deploy the reviewed revision separately, with the existing private environment and database. The automation section receives an anchor for contextual links; policy behavior is unchanged.

## Validation

Record the final checks and source revision in the owner manual and release handoff. Browser previews use only the existing synthetic local database and fake providers, never the live Hostinger database. Desktop/mobile capture, menus, language changes and sign-in destinations are checked in the actual app preview. Existing unit regression suite: 699 cases, 697 passed, two platform skips, zero failures. Type/lint and production build results are recorded after the final source edits.

Browser verification also reproduced and repaired a logout redirect loop: middleware now explicitly clears the stale protected-page marker on the exact public login route. All other routes retain the signature gate and database-backed session check. Four focused middleware/origin checks pass, including the new regression. Sign-in to Start and sign-out to a rendered login form were verified after the fix.
