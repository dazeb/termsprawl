// TesseractSpinner.tsx — the tesseract logo rotating as a loading indicator.
// Shown on the boot overlay while the workspace loads (App.tsx), and reusable
// anywhere a branded spinner fits. Rotation is pure CSS so
// prefers-reduced-motion can stop it (see styles.css).
import React from 'react'
import logoUrl from '../assets/logo.png'

export function TesseractSpinner(): React.JSX.Element {
  return (
    <div className="tesseract-spinner" role="status" aria-label="Loading">
      <img src={logoUrl} alt="" draggable={false} />
    </div>
  )
}
