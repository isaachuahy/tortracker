"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Camera,
  ChartNoAxesCombined,
  Search,
  ShoppingBag,
  LogOut,
  MapPin,
} from "lucide-react";
import { browserClient } from "@/lib/supabase-browser";
export function Shell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    router = useRouter();
  const navigation = [
    { href: "/capture", label: "Capture", Icon: Camera },
    { href: "/spending", label: "Spending", Icon: ChartNoAxesCombined },
    { href: "/prices", label: "Prices", Icon: Search },
  ];
  return (
    <div className="notebook">
      <aside className="sidebar">
        <Link href="/capture" className="brand">
          <ShoppingBag size={25} />
          <span>
            tortracker<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="sidebar-caption">YOUR NOTEBOOK</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={path.startsWith(href) ? "nav-link active" : "nav-link"}
            >
              <Icon size={20} />
              <span>{label}</span>
              {path.startsWith(href) && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="neighborhood">
            <MapPin size={17} />
            <div>
              Toronto<span>King West · College & Yonge</span>
            </div>
          </div>
          <div className="account">
            <span className="avatar">{email.slice(0, 1).toUpperCase()}</span>
            <span className="account-email">{email}</span>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await browserClient().auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span>Small habits. Better grocery runs.</span>
          <span className="private-badge">
            <span />
            Private notebook
            <button
              className="icon-button mobile-logout"
              aria-label="Sign out"
              onClick={async () => {
                await browserClient().auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut size={15} />
            </button>
          </span>
        </header>
        <main className="main-content">{children}</main>
        <footer className="footer">
          Your purchases, your records.
          <span>Prices are dated evidence. Availability may vary.</span>
        </footer>
      </div>
    </div>
  );
}
