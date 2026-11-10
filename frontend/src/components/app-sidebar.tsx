import type * as React from "react"
import { Sidebar, SidebarContent } from "@/components/ui/sidebar"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return <Sidebar collapsible="offcanvas" {...props}><SidebarContent /></Sidebar>
}
