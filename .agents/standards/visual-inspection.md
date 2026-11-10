# 👁️ Visual Context & Multimodal UI Verification

> **Operating Invariant**: For UI, styling, and design work, verbal claims of completion are insufficient. Agents must verify rendered DOM appearance, responsiveness, and contrast using visual artifacts or layout assertions.

---

## 1. Visual Verification Protocol

When creating or modifying frontend components, landing pages, or user interfaces:
1. **Rendered Layout Verification**:
   - Verify layout stability and responsive behavior across viewport breakpoints:
     - Mobile: `390px` (iPhone baseline)
     - Tablet: `768px` (iPad baseline)
     - Desktop: `1280px` (Standard desktop)
2. **Contrast & Accessibility (A11y)**:
   - All body text must maintain a minimum WCAG AA contrast ratio of **4.5:1** against backgrounds.
   - Large headers (>24px) must maintain at least **3:1** contrast.
   - Interactive elements must possess clear `:focus-visible` outlines with at least 2px offset.
3. **Screenshot Storage Invariant**:
   - Verified UI screenshots, component mocks, and visual error captures live strictly inside `./.agents/brand/screenshots/`.
   - Never commit raw uncompressed images to the root repository or documentation tree.

---

## 2. Multimodal Debugging Workflow

If an agent encounters a layout bug, visual regression, or misaligned element:
1. **Capture**: Save the rendered viewport or error capture to `./.agents/brand/screenshots/[name]-[timestamp].png`.
2. **Inspect**: Ingest the image file into multimodal context or analyze computed CSS properties.
3. **Remediate**: Address the specific box-model or flex/grid constraint causing the alignment flaw.
4. **Re-Verify**: Confirm that zero layout shifts or visual clipping remain.
