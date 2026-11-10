import type * as React from "react"
import { CommandIcon, LayoutDashboardIcon, FolderIcon, LogOutIcon, Settings2Icon, UserRoundIcon } from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar({ username, page, onLogout, ...props }: React.ComponentProps<typeof Sidebar> & {
  username: string
  page: string
  onLogout: () => void
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg">
          <a href="#dashboard"><CommandIcon /><span className="font-semibold">WZ-Validierung</span></a>
        </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'dashboard'}>
            <a href="#dashboard"><LayoutDashboardIcon /><span>Dashboard</span></a>
          </SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'moneta'}>
            <a href="#moneta"><FolderIcon /><span>Moneta</span></a>
          </SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
      </SidebarContent>
      <SidebarFooter><SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'settings'}>
          <a href="#settings"><Settings2Icon /><span>Einstellungen</span></a>
        </SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><div className="flex items-center gap-2 px-2 py-2 text-sm"><UserRoundIcon className="size-4" /><span className="truncate">{username}</span></div></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton onClick={onLogout}><LogOutIcon /><span>Abmelden</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu></SidebarFooter>
    </Sidebar>
  )
}
