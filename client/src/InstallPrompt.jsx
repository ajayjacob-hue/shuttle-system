import React, { useState, useEffect } from 'react';

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      console.log("beforeinstallprompt fired!");
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI notify the user they can install the PWA
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
    setDeferredPrompt(null);
  };

  if (!isInstallable) return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-5 py-3 rounded-full shadow-2xl z-[9999] flex items-center space-x-4 border border-blue-400">
      <span className="font-medium whitespace-nowrap text-sm">📲 Install Shuttle App</span>
      <button 
        onClick={handleInstallClick}
        className="bg-white text-blue-700 font-bold px-4 py-1.5 rounded-full text-sm shadow hover:bg-gray-100 transition-colors"
      >
        Install
      </button>
      <button 
        onClick={() => setIsInstallable(false)}
        className="text-white hover:text-gray-200"
      >
        ✕
      </button>
    </div>
  );
};

export default InstallPrompt;
