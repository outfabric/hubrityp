---
name: radix-popover-type-button
description: Radix Popover's PopoverTrigger with asChild sets type="button" on child Input elements, breaking text input for combobox patterns
metadata:
  type: project
---

Radix UI's `PopoverTrigger` with `asChild` merges `type="button"` onto the child element. When wrapping an `<Input>` component, this converts it from `type="text"` to `type="button"`, making keyboard text input impossible. This was discovered in the CID-10 combobox (`cid10-combobox.tsx`) where the search input is wrapped in `<PopoverTrigger asChild>`.

**Why:** This is a known Radix pattern issue. The Popover Trigger inherits from Radix's Primitive.button which sets `type="button"` to prevent form submission. When combined with `asChild` on an Input, the type override breaks text input functionality.

**How to apply:** When reviewing or building combobox patterns that use Radix Popover + Input, always verify the rendered `type` attribute. Use `PopoverAnchor asChild` instead of `PopoverTrigger asChild` for the input element, or add an explicit `type="text"` override that takes precedence.
