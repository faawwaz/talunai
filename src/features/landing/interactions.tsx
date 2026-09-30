"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import Link from "next/link";

const navigation = [
  ["Produk", "#produk"],
  ["Cara Kerja", "#cara-kerja"],
  ["Teknologi", "#teknologi"],
] as const;

export function LandingNav() {
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const sentinel = document.getElementById("landing-top");
    const observer = new IntersectionObserver(([entry]) => {
      header.current?.classList.toggle("is-scrolled", !entry.isIntersecting);
    });
    if (sentinel) observer.observe(sentinel);
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <header ref={header} className="landing-nav">
      <nav
        className="landing-container landing-nav-inner"
        aria-label="Navigasi utama"
      >
        <Link href="/" className="landing-logo" aria-label="Talunai, beranda">
          <Brand />
        </Link>
        <div className="landing-desktop-nav">
          {navigation.map(([label, href]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </div>
        <Link
          href="/app"
          prefetch={false}
          className="landing-button landing-button-primary landing-nav-cta"
        >
          Buka Aplikasi <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <details className="landing-mobile-menu" ref={menu}>
          <summary aria-label="Menu navigasi">
            <Menu className="menu-open-icon" size={21} aria-hidden="true" />
            <X className="menu-close-icon" size={21} aria-hidden="true" />
          </summary>
          <div className="landing-menu-panel">
            {navigation.map(([label, href]) => (
              <a
                href={href}
                key={href}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                {label}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            ))}
          </div>
        </details>
      </nav>
    </header>
  );
}

export function LandingMotion() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const root = document.getElementById("landing");
    const hero = root?.querySelector<HTMLElement>(".landing-hero-art");
    const object = root?.querySelector<HTMLElement>(".landing-hero-object");
    const reveals = root?.querySelectorAll<HTMLElement>("[data-reveal]") ?? [];
    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px 40px 0px" },
    );
    for (const element of reveals) {
      if (
        !reduce.matches &&
        element.getBoundingClientRect().top > window.innerHeight
      ) {
        element.classList.add("reveal-ready");
        observer.observe(element);
      }
    }
    const reset = () => {
      cancelAnimationFrame(frame);
      if (object) object.style.transform = "";
    };
    const move = (event: PointerEvent) => {
      if (reduce.matches || !finePointer.matches || !hero || !object) return;
      const bounds = hero.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        object.style.transform = `translate3d(${x * 7}px, ${y * 5}px, 0) rotate(${x * 1.2}deg)`;
      });
    };
    const preferenceChanged = () => {
      reset();
      if (reduce.matches)
        for (const element of reveals) element.classList.add("is-revealed");
    };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="#"]',
      );
      const target = anchor && document.getElementById(anchor.hash.slice(1));
      if (
        !target ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      history.pushState(null, "", anchor.hash);
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: reduce.matches ? "instant" : "smooth",
        block: "start",
      });
    };
    hero?.addEventListener("pointermove", move);
    hero?.addEventListener("pointerleave", reset);
    root?.addEventListener("click", navigate);
    reduce.addEventListener("change", preferenceChanged);
    return () => {
      observer.disconnect();
      reset();
      hero?.removeEventListener("pointermove", move);
      hero?.removeEventListener("pointerleave", reset);
      root?.removeEventListener("click", navigate);
      reduce.removeEventListener("change", preferenceChanged);
      for (const element of reveals)
        element.classList.remove("reveal-ready", "is-revealed");
    };
  }, []);
  return null;
}
