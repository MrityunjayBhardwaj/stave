/**
 * AddEffectMenu — the ＋More effect-catalog popover (#575).
 *
 * Focus: the scroll-dismiss scope. The menu is a fixed-position portal that
 * closes when an ANCESTOR (the drawer body / page) scrolls, because the fixed
 * anchor would drift. But the menu's own list is `overflowY:auto`, and the
 * dismiss listener is a capture-phase window `scroll` handler — so without an
 * origin guard, scrolling the list itself closes the menu and the user can't
 * browse the long tail. These tests pin BOTH sides: self-scroll survives,
 * ancestor scroll dismisses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AddEffectMenu } from '../AddEffectMenu'

afterEach(() => cleanup())

function openMenu() {
  const utils = render(<AddEffectMenu present={new Set()} onToggle={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /More/ }))
  return utils
}

describe('AddEffectMenu — scroll-dismiss scope', () => {
  it('opens the catalog popover on ＋More', () => {
    openMenu()
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
  })

  it('scrolling the menu LIST does not dismiss it (own overflow scroll)', () => {
    openMenu()
    const menu = document.querySelector('[data-mixer-add-effect-menu]') as HTMLElement
    expect(menu).not.toBeNull()
    // A scroll whose target is inside the menu = the user browsing the list.
    fireEvent.scroll(menu)
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
  })

  it('an ancestor / page scroll DOES dismiss it (fixed anchor would drift)', () => {
    openMenu()
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
    // A scroll originating outside the menu (window/page) closes it.
    fireEvent.scroll(window)
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })

  it('a window resize dismisses it', () => {
    openMenu()
    fireEvent(window, new Event('resize'))
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })

  it('Escape dismisses it', () => {
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })
})

describe('the catalog reaches the take controls (#1530)', () => {
  it('offers Pitch shift, so a take can be shifted without typing it', () => {
    openMenu()
    expect(screen.getByText('Pitch shift')).toBeTruthy()
  })

  it('adds it as `.stretch(1)` — an octave, because unison here is 0 not 1', () => {
    const onToggle = vi.fn()
    render(<AddEffectMenu present={new Set()} onToggle={onToggle} />)
    fireEvent.click(screen.getAllByRole('button', { name: /More/ })[0])
    fireEvent.click(screen.getAllByText('Pitch shift')[0])
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'stretch', def: 1 }),
    )
  })

  it('never labels it as a corrective control — the shift misses by up to 246 cents', () => {
    openMenu()
    const menu = document.querySelector('[data-mixer-add-effect-menu]') as HTMLElement
    expect(/tune|correct|align/i.test(menu.textContent ?? '')).toBe(false)
  })
})
