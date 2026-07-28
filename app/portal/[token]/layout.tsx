import PortalShell from './PortalShell';

export default function PortalLayout({ children, params }: { children: React.ReactNode; params: { token: string } }) {
  return <PortalShell token={params.token}>{children}</PortalShell>;
}
