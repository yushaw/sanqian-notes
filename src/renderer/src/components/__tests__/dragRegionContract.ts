import { expect } from 'vitest'

interface HeaderDragRegionContractOptions {
  container: ParentNode
  rootSelector: string
}

interface RootDragRegionContractOptions {
  container: ParentNode
  rootSelector: string
}

/**
 * Enforces the shared window-drag contract used across sidebar/list columns:
 * - root container must not be a drag region
 * - first child (header strip) must be the drag region
 */
export function expectHeaderOnlyDragRegion({
  container,
  rootSelector,
}: HeaderDragRegionContractOptions) {
  const root = container.querySelector(rootSelector) as HTMLElement | null
  expect(root).toBeTruthy()
  expect(root).not.toHaveClass('drag-region')

  const header = root?.firstElementChild as HTMLElement | null
  expect(header).toBeTruthy()
  expect(header).toHaveClass('drag-region')

  return { root, header }
}

export function expectNoDragControl(control: Element | null) {
  expect(control).toBeTruthy()
  expect(control).toHaveClass('no-drag')
}

export function expectDragRegionElement(element: Element | null) {
  expect(element).toBeTruthy()
  expect(element).toHaveClass('drag-region')
}

/**
 * Enforces drag-strip components where the root itself is draggable
 * (e.g. a tab bar strip) and interactive controls must opt out via no-drag.
 */
export function expectRootDragRegion({
  container,
  rootSelector,
}: RootDragRegionContractOptions) {
  const root = container.querySelector(rootSelector) as HTMLElement | null
  expect(root).toBeTruthy()
  expect(root).toHaveClass('drag-region')
  return { root }
}
