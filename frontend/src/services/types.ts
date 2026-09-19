// Response shapes of the FastAPI backend (see backend/app/schemas/schemas.py).

// collecting: server job (search + read PDFs); collected: papers ready for the
// browser-side analysis; completed: review saved.
export type ProjectStatus = 'pending' | 'collecting' | 'collected' | 'completed' | 'failed'

export interface User {
  id: number
  username: string
  email: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user_id: number
  username: string
}

export interface Project {
  id: number
  user_id: number
  title: string
  topic: string
  description: string | null
  status: ProjectStatus
  progress: number
  current_step: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectList {
  projects: Project[]
  total: number
}

export interface Paper {
  id: number
  project_id: number
  title: string
  authors: string | null // JSON-encoded list
  abstract: string | null
  year: number | null
  url: string | null
  source: string | null
  status: string
  has_full_text: boolean
  created_at: string
}

/** A paper with its extracted text, for the browser-side analysis. */
export interface PaperForAnalysis {
  id: number
  title: string
  authors: string | null
  year: number | null
  abstract: string | null
  full_text: string | null
  url: string | null
  has_extraction: boolean
}

export interface PaperSummary {
  paper_id: number
  summary: string | null
  methodology: string | null
  conclusion: string | null
}

export interface PaperFindings {
  paper_id: number
  model_used: string | null
  dataset_used: string | null
  accuracy: string | null
  contributions: string | null
  limitations: string | null
  raw_json: Record<string, unknown> | null
}

export interface PaperExtractionIn {
  summary: string
  methodology: string
  conclusion: string
  model_used: string
  dataset_used: string
  metrics: string
  contributions: string
  limitations: string
  key_quotes: string[]
  model: string
}

export interface AnalysisIn {
  introduction: string
  body: string
  discussion: string
  conclusion: string
  trends: string
  gaps: string
  comparison: string
  model: string
}

export interface LiteratureReview {
  id: number
  project_id: number
  introduction: string | null
  body: string | null
  discussion: string | null
  conclusion: string | null
  trends: string | null
  gaps: string | null
  comparison: string | null
  created_at: string
}

export interface ChatMessage {
  id: number
  project_id: number
  role: 'user' | 'assistant'
  content: string
  citations: { sources?: Citation[] } | null
  created_at: string
}

export interface Citation {
  paper_title: string
  relevance_score?: number
}

export interface ChatHistory {
  messages: ChatMessage[]
  total: number
}

export interface ChatAnswer {
  answer: string
  citations: Citation[]
}
