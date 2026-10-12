import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuestionType } from '../src/extractor/question-classifier';
import { buildQuestionsPrompt, parseAndValidateAIResponse } from '../src/ai/base';
import { validateElementSafety } from '../src/filler/safety-validator';
import { MacmillanPlatformAdapter } from '../src/platform/macmillan';
import { GenericPlatformAdapter } from '../src/platform/generic';
import { Question } from '../src/types/question';

test('Question Classifier - identifies Question Types correctly', () => {
  // 1. Multiple choice
  const mcType = classifyQuestionType(
    [{ id: 'f1', selector: '#opt1', fieldType: 'radio' }],
    [
      { id: 'o1', label: 'Option A', value: 'a' },
      { id: 'o2', label: 'Option B', value: 'b' },
    ],
    'Select the correct answer:'
  );
  assert.equal(mcType, 'multiple_choice');

  // 2. True / False
  const tfType = classifyQuestionType(
    [{ id: 'f1', selector: '#tf1', fieldType: 'radio' }],
    [
      { id: 'o1', label: 'True', value: 'True' },
      { id: 'o2', label: 'False', value: 'False' },
    ],
    'The sky is blue.'
  );
  assert.equal(tfType, 'true_false');

  // 3. Dropdown
  const dropType = classifyQuestionType(
    [{ id: 'f1', selector: '#sel1', fieldType: 'select' }],
    [],
    'Choose the best option'
  );
  assert.equal(dropType, 'dropdown');

  // 4. Fill in the blank
  const fillType = classifyQuestionType(
    [{ id: 'f1', selector: '#in1', fieldType: 'input' }],
    [],
    'Yesterday she ___ (go) home.'
  );
  assert.equal(fillType, 'fill_in_the_blank');
});

test('AI Prompt Builder - serializes questions cleanly', () => {
  const mockQuestions: Question[] = [
    {
      id: 'q_1',
      index: 1,
      type: 'multiple_choice',
      promptText: 'What is the past participle of write?',
      options: [
        { id: 'o1', label: 'wrote', value: 'wrote' },
        { id: 'o2', label: 'written', value: 'written' },
      ],
      fields: [{ id: 'f1', selector: 'input[name="q1"]', fieldType: 'radio' }],
    },
  ];

  const prompt = buildQuestionsPrompt(mockQuestions);
  assert.match(prompt, /Please solve the following homework questions/);
  assert.match(prompt, /"questionId": "q_1"/);
  assert.match(prompt, /"promptText": "What is the past participle of write\?"/);
});

test('AI Response Parser - parses raw and markdown-fenced JSON responses', () => {
  const mockQuestions: Question[] = [
    {
      id: 'q_1',
      index: 1,
      type: 'fill_in_the_blank',
      promptText: 'She ___ home.',
      fields: [{ id: 'f1', selector: '#input1', fieldType: 'input' }],
    },
  ];

  // Raw JSON
  const rawJson = JSON.stringify({
    suggestions: [
      {
        questionId: 'q_1',
        suggestedAnswer: 'went',
        confidence: 0.95,
        explanation: 'Simple past tense of go is went.',
      },
    ],
  });

  const parsed1 = parseAndValidateAIResponse(rawJson, mockQuestions);
  assert.equal(parsed1.length, 1);
  assert.equal(parsed1[0].suggestedAnswer, 'went');
  assert.equal(parsed1[0].confidence, 0.95);

  // Markdown code block fenced JSON
  const fencedJson = `\`\`\`json
${rawJson}
\`\`\``;

  const parsed2 = parseAndValidateAIResponse(fencedJson, mockQuestions);
  assert.equal(parsed2.length, 1);
  assert.equal(parsed2[0].suggestedAnswer, 'went');
});

test('Safety Validator - blocks assignment submission elements', () => {
  // Test mock submit button
  const fakeSubmitButton = {
    tagName: 'BUTTON',
    type: 'submit',
    innerText: 'Submit Assignment',
    value: '',
  } as unknown as Element;

  const safety1 = validateElementSafety(fakeSubmitButton);
  assert.equal(safety1.isSafe, false);
  assert.match(safety1.reason || '', /automated assignment submission/i);

  // Test dangerous text in button
  const fakeTurnInBtn = {
    tagName: 'BUTTON',
    type: 'button',
    innerText: 'Turn In Homework Now',
    value: '',
  } as unknown as Element;

  const safety2 = validateElementSafety(fakeTurnInBtn);
  assert.equal(safety2.isSafe, false);
});

test('Platform Adapters - detects Macmillan domains accurately', () => {
  const macmillan = new MacmillanPlatformAdapter();
  const generic = new GenericPlatformAdapter();
  const dummyDoc = {} as Document;

  assert.equal(macmillan.isPlatformPage('https://languagehub.macmillaneducation.com/unit-4', dummyDoc), true);
  assert.equal(macmillan.isPlatformPage('https://www.macmillaneducationeverywhere.com/student/dashboard', dummyDoc), true);
  assert.equal(macmillan.isPlatformPage('https://google.com', dummyDoc), false);

  assert.equal(generic.isPlatformPage('https://example.com/homework', dummyDoc), true);
});
