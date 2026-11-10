import { LogOutIcon, UserRoundIcon } from "lucide-react"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

export function NavUser({ username, onLogout }: { username: string; onLogout: () => void }) {
  return <SidebarMenu>
    <SidebarMenuItem><SidebarMenuButton><UserRoundIcon /><span>{username}</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton onClick={onLogout}><LogOutIcon /><span>Abmelden</span></SidebarMenuButton></SidebarMenuItem>
  </SidebarMenu>
}
