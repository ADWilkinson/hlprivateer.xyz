'use client'

import type { ReactNode } from 'react'

export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className='grid transition-[grid-template-rows] duration-200 ease-out'
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className='overflow-hidden'>{children}</div>
    </div>
  )
}
