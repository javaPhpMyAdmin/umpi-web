/**
 * LegalPageLayout — shared sober shell for the legal document pages.
 * Keeps the reading layout consistent: Navbar + centered document card +
 * Footer. Content is the client's literal legal copy — never edited here.
 */
import type { ReactNode } from 'react'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'

interface LegalPageLayoutProps {
  title: string
  updatedAt: string
  children: ReactNode
}

export default function LegalPageLayout({
  title,
  updatedAt,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="font-body-base text-body-base text-on-surface antialiased min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl md:py-10">
        <article className="max-w-3xl mx-auto bg-surface rounded-xl border border-border-light/50 shadow-card px-6 py-8 sm:px-10 sm:py-10">
          <header className="mb-8">
            <h1 className="font-title-lg text-title-lg text-text-deep">{title}</h1>
            <p className="font-small-subtext text-small-subtext text-text-muted mt-2">
              {updatedAt}
            </p>
          </header>

          <div className="flex flex-col gap-8">{children}</div>
        </article>
      </main>

      <Footer />
    </div>
  )
}
