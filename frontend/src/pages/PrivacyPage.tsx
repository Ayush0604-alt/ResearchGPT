import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { GEMINI_HOST } from '../llm/providers/gemini'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-p space-y-2 text-sm text-gray-700 leading-relaxed">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-green-600" size={24} />
          <h1 className="text-xl font-semibold text-gray-900">How your key and data are used</h1>
        </div>

        <Section title="Your AI API key">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              It is stored <strong>only in this browser</strong> (localStorage, under{' '}
              <code>researchgpt-llm</code>).
            </li>
            <li>
              It is sent <strong>only to {GEMINI_HOST}</strong>, in a request header, when your
              browser analyses papers or answers a chat question.
            </li>
            <li>
              It is <strong>never sent to ResearchGPT's servers</strong>, so we can't see, log or
              use it. You can check this in your browser's developer tools (Network tab).
            </li>
            <li>Usage is billed to your own Google account under Google's terms.</li>
            <li>
              Signing out keeps the key so you don't have to paste it again. On a shared computer,
              remove it in{' '}
              <Link to="/settings" className="underline">
                Settings → Clear key
              </Link>
              .
            </li>
          </ul>
        </Section>

        <Section title="What ResearchGPT stores">
          <ul className="list-disc pl-5 space-y-1">
            <li>Your account: email, username and a hash of your password.</li>
            <li>Your projects: topic, title and description.</li>
            <li>
              Papers found for a project: metadata and the text of open-access PDFs. The PDF files
              themselves are not kept.
            </li>
            <li>
              Analysis results and chat messages. They are generated in your browser and saved to
              your account so you can come back to them.
            </li>
            <li>
              Session cookies that JavaScript can't read. Sign-in tokens are stored only as hashes.
            </li>
            <li>
              Server logs with request ids and errors, but no request bodies, passwords or keys.
            </li>
          </ul>
        </Section>

        <Section title="Who else sees what">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Paper search services (Semantic Scholar, arXiv, PubMed) receive your research topic
              from our server when papers are collected.
            </li>
            <li>
              Google receives the paper text and your questions from your browser, sent with your
              key.
            </li>
            <li>No analytics or advertising scripts run on this site.</li>
          </ul>
        </Section>

        <Section title="Deleting your data">
          <p>
            Delete a project from the dashboard at any time. <strong>Delete account</strong> in
            Settings removes your account and everything in it. To remove your key, use Clear key in
            Settings.
          </p>
        </Section>
      </div>
    </div>
  )
}
