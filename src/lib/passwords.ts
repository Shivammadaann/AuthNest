export interface GeneratorOptions {
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSymbols: boolean;
  excludeSimilar: boolean;
}

export interface PasswordStrength {
  score: number;
  label: 'Weak' | 'Fair' | 'Strong' | 'Excellent';
  isWeak: boolean;
  suggestions: string[];
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 18,
  includeUppercase: true,
  includeLowercase: true,
  includeNumbers: true,
  includeSymbols: true,
  excludeSimilar: true,
};

const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const NUMBERS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}<>?';
const SIMILAR_CHARACTERS = new Set(['I', 'l', '1', 'O', '0']);

const getRandomNumber = (max: number) => {
  if (max <= 0) {
    return 0;
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % max;
  }

  return Math.floor(Math.random() * max);
};

const pickCharacter = (characters: string) => characters[getRandomNumber(characters.length)];

const shuffle = (value: string) => {
  const chars = value.split('');

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = getRandomNumber(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }

  return chars.join('');
};

export function generatePasswordValue(options: GeneratorOptions): string {
  const groups = [
    options.includeLowercase ? LOWERCASE : '',
    options.includeUppercase ? UPPERCASE : '',
    options.includeNumbers ? NUMBERS : '',
    options.includeSymbols ? SYMBOLS : '',
  ].filter(Boolean);

  if (groups.length === 0) {
    return '';
  }

  const requiredCharacters = groups.map((group) => pickCharacter(group));
  let pool = groups.join('');

  if (!options.excludeSimilar) {
    pool += 'Il1O0';
  }

  const targetLength = Math.max(options.length, requiredCharacters.length);
  const generated = [...requiredCharacters];

  while (generated.length < targetLength) {
    generated.push(pickCharacter(pool));
  }

  const shuffled = shuffle(generated.join(''));

  if (!options.excludeSimilar) {
    return shuffled;
  }

  return shuffled
    .split('')
    .filter((character) => !SIMILAR_CHARACTERS.has(character))
    .join('')
    .slice(0, targetLength);
}

export function scorePasswordStrength(value: string): PasswordStrength {
  if (!value) {
    return {
      score: 0,
      label: 'Weak',
      isWeak: true,
      suggestions: ['Add a password to protect this vault item.'],
    };
  }

  let score = 0;
  const suggestions: string[] = [];

  const checks = {
    length12: value.length >= 12,
    length16: value.length >= 16,
    lower: /[a-z]/.test(value),
    upper: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };

  if (checks.length12) {
    score += 25;
  } else {
    suggestions.push('Use at least 12 characters.');
  }

  if (checks.length16) {
    score += 10;
  }

  if (checks.lower) {
    score += 15;
  } else {
    suggestions.push('Add lowercase letters.');
  }

  if (checks.upper) {
    score += 15;
  } else {
    suggestions.push('Add uppercase letters.');
  }

  if (checks.number) {
    score += 15;
  } else {
    suggestions.push('Add numbers.');
  }

  if (checks.symbol) {
    score += 20;
  } else {
    suggestions.push('Add symbols.');
  }

  if (/([A-Za-z0-9])\1{2,}/.test(value)) {
    score = Math.max(0, score - 10);
    suggestions.push('Avoid repeated characters.');
  }

  const cappedScore = Math.max(0, Math.min(100, score));

  if (cappedScore >= 85) {
    return {
      score: cappedScore,
      label: 'Excellent',
      isWeak: false,
      suggestions,
    };
  }

  if (cappedScore >= 65) {
    return {
      score: cappedScore,
      label: 'Strong',
      isWeak: false,
      suggestions,
    };
  }

  if (cappedScore >= 40) {
    return {
      score: cappedScore,
      label: 'Fair',
      isWeak: true,
      suggestions,
    };
  }

  return {
    score: cappedScore,
    label: 'Weak',
    isWeak: true,
    suggestions,
  };
}
