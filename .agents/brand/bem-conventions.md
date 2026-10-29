# 📐 Semantic BEM CSS Class Architecture

> **Purpose**: Standardized Block-Element-Modifier convention for modular, self-documenting, conflict-free styling.

---

## 1. Naming Structure

```
.block                    → Standalone component root (e.g., .card, .navbar, .modal)
.block__element           → Child part of block (e.g., .card__title, .navbar__item)
.block--modifier          → Variant of block (e.g., .card--featured, .btn--primary)
.block__element--modifier → Variant of element (e.g., .navbar__link--active)
```

---

## 2. Core Rules

1. **Block**: Lowercase, hyphen-separated for multi-word names (`.pricing-table`, `.hero-banner`).
2. **Element**: Separated by double underscore (`__`) (`.pricing-table__tier`, `.hero-banner__heading`).
3. **Modifier**: Separated by double hyphen (`--`) (`.pricing-table--highlighted`, `.btn--danger`).
4. **Shallow Depth**: Never nest elements beyond one level (`.block__element` ONLY; never `.block__element__subelement`).
5. **Separation of Concerns**: Avoid using tag selectors (`div`, `p`, `span`) directly in stylesheets. Target explicit BEM classes.

---

## 3. Reference Implementation

```html
<article class="card card--featured">
  <img class="card__image" src="/img/coffee.webp" alt="Artisan blend coffee bag" />
  <div class="card__body">
    <h3 class="card__title">Signature Dark Roast</h3>
    <p class="card__description">Notes of dark chocolate, toasted hazelnut, and caramel.</p>
    <div class="card__footer">
      <span class="card__price">$18.00</span>
      <button class="btn btn--primary btn--sm">Add to Cart</button>
    </div>
  </div>
</article>
```
