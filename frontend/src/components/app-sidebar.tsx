import type * as React from "react"
import { CommandIcon, ChartColumnIcon, ScanLineIcon, FolderIcon, LogOutIcon, Settings2Icon, UserRoundIcon, ShieldCheckIcon } from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar({ username, isAdmin, page, onLogout, ...props }: React.ComponentProps<typeof Sidebar> & {
  username: string
  isAdmin: boolean
  page: string
  onLogout: () => void
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg">
          <a href="#moneta"><CommandIcon /><span className="font-semibold">WZ-Validierung</span></a>
        </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'moneta'}>
            <a href="#moneta"><FolderIcon /><span>Moneta</span></a>
          </SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'classification'}>
            <a href="#classification"><ScanLineIcon /><span>Klassifizierung</span></a>
          </SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
        <SidebarGroup><SidebarGroupLabel>Prüfstation</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'review'}><a href="#review"><ShieldCheckIcon /><span>Laufende Prüfungen</span></a></SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'review-completed'}><a href="#review-completed"><FolderIcon /><span>Abgeschlossene Prüfungen</span></a></SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
        <SidebarGroup><SidebarGroupLabel>Analyse</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'analysis'}><a href="#analysis"><ChartColumnIcon /><span>Modellanalyse</span></a></SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'evaluation'}><a href="#evaluation"><ChartColumnIcon /><span>Evaluation</span></a></SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu></SidebarGroupContent></SidebarGroup>
      </SidebarContent>
      <SidebarFooter><SidebarMenu>
        {isAdmin && <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'admin'}><a href="#admin"><ShieldCheckIcon /><span>Admin-Panel</span></a></SidebarMenuButton></SidebarMenuItem>}
        <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'settings'}>
          <a href="#settings"><Settings2Icon /><span>Einstellungen</span></a>
        </SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'profile'}><a href="#profile"><UserRoundIcon /><span className="truncate">Profil · {username}</span></a></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton onClick={onLogout}><LogOutIcon /><span>Abmelden</span></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu></SidebarFooter>
    </Sidebar>
  )
}
