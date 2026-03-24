import { useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import Typewriter from './components/Typewriter';
import { useTypewriterAnimation } from './hooks/useTypewriterAnimation';

export default function App() {
  const containerRef = useRef(null);
  const nameInputRef = useRef(null);
  const emailInputRef = useRef(null);
  const paperContactFormFORef = useRef(null);
  const [paperFormHost, setPaperFormHost] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState('name');
  const { init, playIntro, liftPaperForForm, setContactFormRow } = useTypewriterAnimation();

  const goToEmailStep = useCallback(() => {
    setContactFormRow(1);
    setFormStep('email');
    requestAnimationFrame(() => emailInputRef.current?.focus());
  }, [setContactFormRow]);

  const handleReady = useCallback(
    (container) => {
      containerRef.current = container;
      if (container.dataset?.typewriterInited === '1') return;
      container.dataset.typewriterInited = '1';
      init(container);
      playIntro(({ paperFormHost: hostEl, paperContactFormFO: foEl }) => {
        paperContactFormFORef.current = foEl ?? null;
        setFormStep('name');
        if (foEl) {
          foEl.setAttribute(
            'style',
            'display:block;pointer-events:auto;visibility:visible;overflow:visible',
          );
        }
        const host = hostEl ?? container.querySelector('#PaperFormHost');
        setPaperFormHost(host || null);
        setShowForm(Boolean(host));
        if (host) {
          requestAnimationFrame(() => nameInputRef.current?.focus());
        }
      });
    },
    [init, playIntro],
  );

  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      const fo = paperContactFormFORef.current;
      if (fo?.isConnected)
        fo.setAttribute('style', 'display:none;pointer-events:none;visibility:hidden');
      paperContactFormFORef.current = null;
      setShowForm(false);
      setPaperFormHost(null);
      setFormStep('name');
      liftPaperForForm();
    },
    [liftPaperForForm],
  );

  const formTypography = {
    fontFamily: "'Courier Prime', 'Courier New', monospace",
    fontSize: '5.5px',
    lineHeight: 1.2,
    color: '#09090b',
    opacity: 0.9,
    userSelect: 'text',
  };

  return (
    <div className="relative w-screen h-screen bg-zinc-900 flex items-center justify-center overflow-hidden">
      <div className="relative h-full w-full max-w-[1400px] p-4 select-none">
        <Typewriter ref={containerRef} onReady={handleReady} />
        {showForm && paperFormHost
          ? createPortal(
            <form
              onSubmit={handleSend}
              className="h-full w-full"
              style={formTypography}
            >
              {formStep === 'name' ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  name="name"
                  placeholder="Name"
                  className="m-0 h-full w-full border-0 border-b border-zinc-800 bg-transparent p-0 outline-none placeholder:text-zinc-600"
                  style={{ font: 'inherit' }}
                  autoComplete="name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      goToEmailStep();
                    }
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center gap-1">
                  <input
                    ref={emailInputRef}
                    type="email"
                    name="email"
                    placeholder="Email"
                    className="m-0 min-w-0 flex-1 border-0 border-b border-zinc-800 bg-transparent p-0 outline-none placeholder:text-zinc-600"
                    style={{ font: 'inherit' }}
                    autoComplete="email"
                  />
                  <button
                    type="submit"
                    className="m-0 shrink-0 border border-zinc-800 bg-transparent px-1 py-0 leading-none text-inherit hover:bg-zinc-900 hover:text-white"
                    style={{ font: 'inherit' }}
                  >
                    Send
                  </button>
                </div>
              )}
            </form>,
            paperFormHost,
          )
          : null}
      </div>
    </div>
  );
}
