import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/Button';
import { SlackConnect } from './SlackConnect';

export function Header({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">R</span>
          ReachInbox
        </div>
        <div className="flex items-center gap-4">
          <SlackConnect />
          <div className="flex items-center gap-3">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-gray-500">{user.email}</div>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              await logout();
              onLoggedOut();
            }}
          >
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
