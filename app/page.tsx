import { redirect } from 'next/navigation';

// middleware.ts already runs auth.protect() on every non-public route,
// including this one — so anyone reaching this component is guaranteed to
// be signed in. This just sends them straight into the coach dashboard
// instead of the placeholder page that used to live here.
export default function HomePage() {
  redirect('/caseload');
}
