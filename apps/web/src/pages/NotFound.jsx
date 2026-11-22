import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-ink-faint">
        <Compass size={22} />
      </div>
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
        The page you requested doesn't exist, or you may not have access to it.
      </p>
      <Link to="/overview" className="mt-5">
        <Button variant="secondary">Back to overview</Button>
      </Link>
    </div>
  );
}
