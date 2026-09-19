// Response shapes of the FastAPI backend (see backend/app/schemas/schemas.py).

export type ProjectStatus = 'pending' | 'running' | 'completed' | 'failed'

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
  task_id: string | null
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
  created_at: string
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

export interface TaskStatus {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown'
  progress: number | null
  current_agent: string | null
  error: string | null
}
