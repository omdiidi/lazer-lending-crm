import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { AlertBanner } from '@/components/AlertBanner';

export default function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onTodos = pathname === '/todos';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b bg-background px-4 gap-2">
            <SidebarTrigger />
            <Button
              size="sm"
              variant={onTodos ? 'default' : 'secondary'}
              onClick={() => navigate('/todos')}
              aria-current={onTodos ? 'page' : undefined}
              className="md:hidden gap-1.5"
            >
              <ListTodo className="h-4 w-4" />
              To-Do
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                {user?.name.split(' ').map(n => n[0]).join('')}
              </div>
            </div>
          </header>
          <AlertBanner />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
