// Translation API - uses static translations first, then API for missing keys
// Completely free and unlimited

const TRANSLATE_API_URL = 'https://api.mymemory.translated.net/get';

// Cache for API translations
const apiCache = {};

// Translate text using API (fallback for missing static translations)
async function translateWithAPI(text, targetLang, sourceLang = 'en') {
  if (targetLang === 'en' || !text || !text.trim()) {
    return text;
  }

  const cacheKey = `${sourceLang}-${targetLang}-${text}`;
  if (apiCache[cacheKey]) {
    return apiCache[cacheKey];
  }

  try {
    const response = await fetch(
      `${TRANSLATE_API_URL}?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`
    );

    if (!response.ok) {
      return text; // Fallback to original
    }

    const data = await response.json();
    
    if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
      const translatedText = data.responseData.translatedText.trim();
      apiCache[cacheKey] = translatedText;
      return translatedText;
    }
  } catch (error) {
    console.warn('API translation failed:', error);
  }
  
  return text; // Fallback to original
}

// Translate all elements on the page - uses static translations first, API for missing
async function translatePage(lang = 'en') {
  console.log('Translating page to:', lang);
  
  // Update HTML lang attribute
  document.documentElement.lang = lang;
  
  // Store current language
  localStorage.setItem('authentIC_language', lang);
  
  // Load static translations (from translations.js)
  const staticTranslations = typeof translations !== 'undefined' ? translations : {};
  const t = staticTranslations[lang] || {};
  const fallback = staticTranslations.en || {};
  
  // Get English text for API fallback
  const getEnglishText = (element) => {
    const key = element.getAttribute('data-i18n');
    return fallback[key] || element.textContent || '';
  };
  
  // Translate all elements
  const elementsToTranslate = Array.from(document.querySelectorAll('[data-i18n]'));
  
  for (const element of elementsToTranslate) {
    const key = element.getAttribute('data-i18n');
    let translation = t[key];
    
    // If no static translation, use API
    if (!translation) {
      const englishText = fallback[key] || getEnglishText(element);
      if (englishText && lang !== 'en') {
        translation = await translateWithAPI(englishText, lang);
      } else {
        translation = englishText || element.textContent;
      }
    }
    
    if (translation) {
      const tagName = element.tagName.toUpperCase();
      if (tagName === 'P' || tagName === 'DIV' || tagName === 'H1' || tagName === 'H2' || tagName === 'H3' || tagName === 'H4' || tagName === 'H5' || tagName === 'H6' || tagName === 'LI') {
        // Preserve pendingCount ID when translating
        const pendingCountEl = element.querySelector('#pendingCount');
        const pendingCount = pendingCountEl ? pendingCountEl.textContent : '0';
        
        element.innerHTML = translation;
        
        // Restore pendingCount ID if it was present and translation doesn't have it
        if (pendingCountEl && !element.querySelector('#pendingCount')) {
          const strongTags = element.querySelectorAll('strong');
          if (strongTags.length > 0) {
            // Use the first strong tag or the one that contains a number
            let targetStrong = null;
            for (const strong of strongTags) {
              if (strong.textContent.match(/\d+/)) {
                targetStrong = strong;
                break;
              }
            }
            if (!targetStrong && strongTags.length > 0) {
              targetStrong = strongTags[0];
            }
            if (targetStrong) {
              targetStrong.id = 'pendingCount';
              targetStrong.textContent = pendingCount;
            }
          }
        }
      } else if (tagName === 'BUTTON' || tagName === 'A') {
        const hasChildren = element.children.length > 0;
        if (hasChildren) {
          let textSpan = element.querySelector('span[data-i18n]');
          if (textSpan) {
            textSpan.textContent = translation;
          } else {
            textSpan = Array.from(element.children).find(child => child.tagName === 'SPAN' && !child.querySelector('svg'));
            if (textSpan) {
              textSpan.textContent = translation;
            } else {
              const newSpan = document.createElement('span');
              element.appendChild(newSpan);
              newSpan.textContent = translation;
            }
          }
        } else {
          element.textContent = translation;
        }
      } else if (tagName === 'SPAN') {
        element.textContent = translation;
      } else {
        element.textContent = translation;
      }
    }
  }
  
  // Translate placeholders
  const placeholdersToTranslate = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));
  for (const element of placeholdersToTranslate) {
    const key = element.getAttribute('data-i18n-placeholder');
    let translation = t[key];
    
    if (!translation) {
      const englishText = fallback[key] || element.placeholder || '';
      if (englishText && lang !== 'en') {
        translation = await translateWithAPI(englishText, lang);
      } else {
        translation = englishText;
      }
    }
    
    if (translation) {
      element.placeholder = translation;
    }
  }
  
  console.log('Translation complete');
}

// Make translatePage available globally
window.translatePage = translatePage;

// Initialize translation on page load
async function initTranslation() {
  // Always default to English
  const savedLang = localStorage.getItem('authentIC_language');
  const langToUse = savedLang && savedLang !== 'en' ? savedLang : 'en';
  
  // If no saved language, ensure it's set to English
  if (!savedLang) {
    localStorage.setItem('authentIC_language', 'en');
  }
  
  setTimeout(async () => {
    if (typeof window.translatePage === 'function') {
      await window.translatePage(langToUse);
    } else {
      console.error('translatePage function not found!');
    }
  }, 100);
}

// Run translation when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTranslation);
} else {
  initTranslation();
}

// Export function to update pending count after translations
window.updatePendingCountAfterTranslation = function(count) {
  setTimeout(() => {
    const pendingCountEl = document.getElementById('pendingCount');
    if (pendingCountEl) {
      pendingCountEl.textContent = count;
    }
  }, 100);
};

