# Purchase Fields for Ingredients and Bread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add category, margin, and selling-price controls to purchase lines for ingredients and bread, persisting them to the correct catalog fields.

**Architecture:** Extend the existing pure purchase-price projection to identify catalog rows by type, then connect the final purchase renderer and save path to the correct catalog fields. Add a bread price field to the existing stock editor/list so the value is visible and editable.

**Tech Stack:** Vanilla JavaScript in `index.html`, pure calculation module in `purchase-pricing.js`, Node test suite exists but this turn's verification is limited to static/syntax checks.

**Spec:** `docs/superpowers/specs/2026-11-17-purchase-fields-ingredients-bread-design.md`

## Global Constraints

- Keep Product, Ingredient, and Bread pricing groups independent even when names match.
- Start a bread sale price blank unless the bread catalog already has a saved positive price.
- Preserve existing stock application, discounts, purchase snapshots, and old notes.
- Do not change Supabase schema/RLS or write to production data.

## Review Focus

- Same item name in multiple types stays separated: pricing projection must resolve by type and catalog ID.
- Item and invoice discounts affect only their proper cost base: retain current discount allocation.
- Ingredient flexible units and yields: projection quantity must match stock application quantity.
- Existing bread without a `preco` remains blank and does not get a fake default.
- Editing a saved purchase reverses that item's previous stock before projecting the new cost.

### Task 1: Project prices by catalog type

**Files:** Modify `purchase-pricing.js`; inspect/update `tests/purchase-pricing.test.cjs` only if test execution is explicitly requested.

- [x] Extend type-specific catalog lookup for product, ingredient, and bread.
- [x] Include each type's applied stock quantity and cost in its weighted-average projection.
- [x] Preserve note reversal and discount allocation for each stock target.

### Task 2: Render and persist purchase fields by item type

**Files:** Modify `index.html` purchase renderer and save handler.

- [x] Show category, margin, sale price for Ingredient and Bread alongside existing type-specific controls.
- [x] Compute each row from its matching catalog item, using the existing quantity conversion for ingredients.
- [x] Save Ingredient price to `precoExtra` and its existing category; save Bread price to `preco` and its category; keep Product behavior unchanged.
- [x] Keep a missing Bread price blank and leave old note snapshots untouched.

### Task 3: Expose the Bread price in stock editing

**Files:** Modify `index.html` bread row rendering and bread modal load/save handlers.

- [x] Display saved Bread price in the stock list when set.
- [x] Allow viewing/editing the optional price in the bread modal without changing stock or recipe prices.
- [x] Run syntax checks on changed JavaScript assets and inspect the final diff.
