# Design System Specification: The Observability Canvas

## 1. Overview & Creative North Star: "The Digital Curator"
The Creative North Star for this system is **The Digital Curator**. Unlike traditional observability tools that overwhelm the user with "data density," this system treats data as high-end editorial content. We move beyond the "dashboard" and toward a "canvas."

The aesthetic breaks the standard SaaS template through **intentional asymmetry** and **tonal depth**. By utilizing a split-screen architecture—a fluid content canvas on the left and a persistent, high-context AI panel on the right—we create a workspace that feels like a sophisticated studio rather than a cockpit. We prioritize breathing room, crisp typography, and the total elimination of structural lines in favor of layered surfaces.

---

## 2. Colors & Surface Architecture
Our palette is rooted in deep, ink-like charcoals, using vibrant accents not for decoration, but for semantic precision.

### The "No-Line" Rule
**Strict Mandate:** 1px solid borders are prohibited for sectioning. Structural boundaries must be defined solely through background color shifts. To separate a sidebar from the main canvas, transition from `surface` (#0e0e0e) to `surface_container_low` (#131313). 

### Surface Hierarchy & Nesting
Depth is achieved by "stacking" container tiers. Use these levels to define importance:
- **Base Layer:** `surface` (#0e0e0e) – The primary application background.
- **Structural Zones:** `surface_container_low` (#131313) – Used for the collapsible left sidebar and the background of the AI chat panel.
- **Active Canvas:** `surface_container` (#1a1919) – The background for the dynamic content area.
- **Interactive Elements:** `surface_container_high` (#201f1f) – Used for cards, code blocks, or nested data modules.

### The "Glass & Gradient" Rule
To elevate the UI above "standard dark mode," use **Glassmorphism** for floating elements (like command palettes or tooltips). Use `surface_bright` (#2c2c2c) at 60% opacity with a `backdrop-blur` of 20px. 
*   **Signature Texture:** Main Action Buttons or critical AI insights should utilize a subtle linear gradient from `primary` (#a3a6ff) to `primary_container` (#9396ff) at a 135-degree angle to provide visual "soul."

---

## 3. Typography: Editorial Authority
We pair **Manrope** (Display/Headline) with **Inter** (UI/Body) to balance character with readability.

*   **Display & Headlines (Manrope):** Large, low-tracking titles (`display-lg` at 3.5rem) provide an authoritative, editorial feel. Use `on_surface` (#ffffff) for maximum contrast.
*   **Body & Labels (Inter):** Used for high-density data and AI chat logs. `body-md` (0.875rem) is the workhorse for chat bubbles, while `label-sm` (0.6875rem) in `on_surface_variant` (#adaaaa) handles metadata and timestamps.
*   **Hierarchy Tip:** Use `tertiary` (#c180ff) for syntax highlighting and AI-generated keywords to distinguish machine-intelligence from system text.

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are too heavy for an AI-first platform. We use light and tone to imply height.

*   **The Layering Principle:** Instead of a drop shadow on a card, place a `surface_container_highest` (#262626) card on a `surface_container` (#1a1919) canvas. The difference in hex value provides a "soft lift."
*   **Ambient Shadows:** For floating AI modals, use a shadow with a 40px blur and 6% opacity. The shadow color must be a tinted version of `primary` (e.g., #a3a6ff at 5% alpha) to mimic the glow of the screen.
*   **The "Ghost Border" Fallback:** If a divider is required for accessibility, use `outline_variant` (#494847) at **15% opacity**. It should be felt, not seen.

---

## 5. Components & Primitive Styling

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_dim`), roundedness `md` (0.75rem), `on_primary_fixed` (#000000) text.
- **Secondary/Ghost:** No background. `outline` (#777575) at 20% opacity for the border. On hover, shift background to `surface_container_highest`.

### AI Chat Panel (Right Side)
- **Container:** `surface_container_low`. 
- **Chat Bubbles (AI):** `surface_container_high` with a subtle `primary` glow on the top-left edge.
- **Chat Bubbles (User):** `surface_variant` (#262626).
- **Spacing:** Use Spacing `5` (1.1rem) for internal padding to ensure the AI conversation feels breathable.

### Data Visualization Canvas
- **Cards:** Forbid divider lines. Use Spacing `8` (1.75rem) to separate charts.
- **Gradients:** Use `secondary` (#62fae3) for "Healthy" metrics and `error` (#ff6e84) for "Critical." Apply a 10% opacity glow of the same color behind data points to suggest "energy."

### Inputs & AI Command Bar
- **The Prompt Bar:** Use `surface_bright` (#2c2c2c) with a `xl` (1.5rem) corner radius to make the AI interaction feel distinct from standard text inputs.

---

## 6. Do’s and Don'ts

### Do
- **Do** use `secondary_fixed` (#62fae3) sparingly for success states to keep the UI "cool" and professional.
- **Do** use asymmetric layouts. If a chart is wide, let the AI panel remain narrow, creating a "Focus vs. Context" relationship.
- **Do** utilize `surface_container_lowest` (#000000) for the most background-level elements to maximize the "infinite depth" feel of OLED screens.

### Don't
- **Don't** use 100% white (#ffffff) for secondary text; always use `on_surface_variant` (#adaaaa) to maintain visual hierarchy.
- **Don't** use sharp corners. Everything must adhere to the `md` (0.75rem) to `lg` (1rem) roundedness scale to feel approachable.
- **Don't** use standard "Grey" shadows. Always tint shadows with a hint of the `surface_tint` (#a3a6ff) to maintain the "AI Era" atmosphere.