import { describe, expect, it } from 'vitest'
import { errorMessage } from './api'

const axiosError = (detail) => ({ response: { data: { detail } } })

describe('errorMessage', () => {
  it('passes through string details', () => {
    expect(errorMessage(axiosError('Email already registered'))).toBe('Email already registered')
  })

  it('formats FastAPI 422 validation lists', () => {
    const err = axiosError([
      { loc: ['body', 'username'], msg: 'String should have at least 3 characters' },
      { loc: ['body', 'password'], msg: 'Value error, Password must be at most 72 bytes' },
    ])
    expect(errorMessage(err)).toBe(
      'username: String should have at least 3 characters; password: Password must be at most 72 bytes',
    )
  })

  it('falls back when there is no usable detail', () => {
    expect(errorMessage(new Error('Network Error'), 'Try again')).toBe('Try again')
    expect(errorMessage(axiosError([]), 'Try again')).toBe('Try again')
  })
})
