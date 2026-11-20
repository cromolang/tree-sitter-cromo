/**
 * @file Cromo grammar for tree-sitter
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// The binary operators, from the lowest precedence to the highest. The levels
// are written as separate rules instead of with `prec`, because `>>` is two
// `>` next to each other (one alone closes `list<list<i32>>`) and so the
// parser cannot tell a comparison from a shift at the first `>`.
const BINARY_LEVELS = [
  ['or', ['||']],
  ['and', ['&&']],
  ['equality', ['==', '!=']],
  ['relational', ['<', '<=', '>', '>=']],
  ['bitor', ['|']],
  ['bitxor', ['^']],
  ['bitand', ['&']],
  ['shift', ['<<']],
  ['additive', ['+', '-']],
  ['multiplicative', ['*', '/', '%']],
];

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

function commaSep(rule) {
  return optional(commaSep1(rule));
}

// Items on separate lines; the last one may be followed by the closing brace.
function lines($, rule) {
  return seq(repeat(seq(rule, $._newline)), optional(rule));
}

const binaryRules = {};
BINARY_LEVELS.forEach(([name, operators], index) => {
  const next = index + 1 < BINARY_LEVELS.length ? `_${BINARY_LEVELS[index + 1][0]}_expression` : '_unary_expression';
  binaryRules[`_${name}_expression`] = $ => choice($[next], alias($[`_${name}_binary`], $.binary_expression));
  binaryRules[`_${name}_binary`] = $ => seq(
    field('left', $[`_${name}_expression`]),
    field('operator', name === 'shift'
      ? choice(...operators, seq('>', token.immediate('>')))
      : (operators.length > 1 ? choice(...operators) : operators[0])),
    field('right', $[next]),
  );
});

module.exports = grammar({
  name: 'cromo',

  word: $ => $.identifier,

  externals: $ => [
    $._newline,
    $._error_sentinel,
  ],

  extras: $ => [
    /\s/,
    $.comment,
  ],

  conflicts: $ => [
    [$._equality_binary, $._relational_binary],
    [$._bitand_binary, $._shift_binary],
    [$._equality_expression, $._relational_binary],
    [$._type_identifier, $._primary_expression],
    [$._primary_expression, $.capture],
    [$.list_literal, $.capture_list],
    [$._postfix_expression, $.call_expression],
    [$._bitand_expression, $._shift_binary],
    [$._type_identifier, $.call_expression, $._primary_expression],
    [$.qualified_type, $._primary_expression],
    [$.function_type],
  ],

  rules: {
    source_file: $ => repeat($._top_level_item),

    _top_level_item: $ => choice(
      seq($.import_declaration, $._newline),
      $.extern_block,
      $.struct_declaration,
      $.enum_declaration,
      $.interface_declaration,
      $.function_definition,
      seq($.variable_declaration, $._newline),
    ),

    // ---- Modules ----

    import_declaration: $ => seq(
      'import',
      choice(field('path', $.module_path), 'unsafe'),
    ),

    module_path: $ => seq($.identifier, repeat(seq('.', $.identifier))),

    extern_block: $ => seq(
      'extern',
      field('library', $.string_literal),
      field('body', $.extern_body),
    ),

    extern_body: $ => seq('{', lines($, $.function_signature), '}'),

    function_signature: $ => seq(
      field('return_type', $._type),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
    ),

    // ---- Attributes ----

    attribute: $ => seq(
      '[', '[',
      field('name', $.identifier),
      optional(field('arguments', $.attribute_arguments)),
      ']', ']',
    ),

    attribute_arguments: $ => seq(
      '(',
      commaSep1(choice($.string_literal, $.identifier)),
      ')',
    ),

    // ---- Functions ----

    function_definition: $ => seq(
      repeat($.attribute),
      optional('public'),
      field('return_type', $._type),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.parameter_list),
      field('body', $.block),
    ),

    type_parameters: $ => seq('<', commaSep1($.type_parameter), '>'),

    type_parameter: $ => seq(
      field('name', alias($.identifier, $.type_identifier)),
      optional(seq(':', field('bound', $._type), repeat(seq('+', field('bound', $._type))))),
    ),

    parameter_list: $ => seq('(', commaSep($.parameter), ')'),

    parameter: $ => seq(
      optional(choice('ref', seq('move', optional('const')), 'const')),
      field('type', $._type),
      field('name', $.identifier),
    ),

    // ---- Structs, enums and interfaces ----

    struct_declaration: $ => seq(
      optional('public'),
      'struct',
      field('name', alias($.identifier, $.type_identifier)),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('interfaces', $.interface_list)),
      field('body', $.struct_body),
    ),

    interface_list: $ => seq(':', commaSep1($._type)),

    struct_body: $ => seq('{', lines($, $._struct_member), '}'),

    _struct_member: $ => choice(
      $.field_declaration,
      $.constructor_definition,
      $.destructor_definition,
      $.method_definition,
    ),

    field_declaration: $ => seq(
      repeat($.attribute),
      optional('public'),
      field('type', $._type),
      field('name', $.identifier),
      optional(seq('=', field('value', $._expression))),
    ),

    constructor_definition: $ => seq(
      optional('public'),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      field('body', $.block),
    ),

    destructor_definition: $ => seq(
      '~',
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      field('body', $.block),
    ),

    method_definition: $ => seq(
      optional('public'),
      field('return_type', $._type),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.parameter_list),
      optional('const'),
      field('body', $.block),
    ),

    enum_declaration: $ => seq(
      optional('public'),
      'enum',
      field('name', alias($.identifier, $.type_identifier)),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('interfaces', $.interface_list)),
      field('body', $.enum_body),
    ),

    enum_body: $ => seq('{', lines($, choice($.enum_case, $.method_definition)), '}'),

    enum_case: $ => seq(
      repeat($.attribute),
      field('name', $.identifier),
      optional(field('parameters', $.parameter_list)),
      optional(seq('=', field('value', $._expression))),
    ),

    interface_declaration: $ => seq(
      optional('public'),
      'interface',
      field('name', alias($.identifier, $.type_identifier)),
      field('body', $.interface_body),
    ),

    interface_body: $ => seq('{', lines($, $.method_signature), '}'),

    method_signature: $ => seq(
      field('return_type', $._type),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.parameter_list),
      optional('const'),
    ),

    // ---- Types ----

    _type: $ => choice(
      $.void_type,
      $._simple_type,
      $.array_type,
      $.function_type,
    ),

    void_type: _ => 'void',

    _simple_type: $ => choice(
      $._type_identifier,
      $.qualified_type,
      $.generic_type,
    ),

    _type_identifier: $ => alias($.identifier, $.type_identifier),

    qualified_type: $ => seq(
      field('module', $.identifier),
      '.',
      field('name', alias($.identifier, $.type_identifier)),
    ),

    generic_type: $ => seq(
      field('type', choice($._type_identifier, $.qualified_type)),
      field('arguments', $.type_arguments),
    ),

    // A parse with type arguments wins over one that reads `<` and `>` as
    // comparisons, as the lookahead of the compiler decides.
    type_arguments: $ => prec.dynamic(1, seq('<', commaSep1($._type), '>')),

    array_type: $ => seq(
      field('element', choice($._simple_type, $.array_type)),
      '[',
      field('size', $.integer_literal),
      ']',
    ),

    function_type: $ => seq(
      'func',
      field('parameters', $.function_type_parameters),
      optional(field('result', $._type)),
    ),

    function_type_parameters: $ => seq(
      '(',
      commaSep(seq(optional(choice('ref', 'move')), $._type)),
      ')',
    ),

    // ---- Statements ----

    block: $ => seq('{', lines($, $._statement), '}'),

    _statement: $ => choice(
      $.variable_declaration,
      $.return_statement,
      $.throw_statement,
      $.break_statement,
      $.continue_statement,
      $.if_statement,
      $.for_statement,
      $.switch_statement,
      $.try_statement,
      $._simple_statement,
    ),

    _simple_statement: $ => choice(
      $.assignment_statement,
      $.update_statement,
      $.expression_statement,
    ),

    variable_declaration: $ => seq(
      optional('const'),
      field('type', $._type),
      field('name', $.identifier),
      optional(seq('=', field('value', $._expression))),
    ),

    return_statement: $ => seq('ret', optional($._expression)),

    throw_statement: $ => seq('throw', optional($._expression)),

    break_statement: _ => 'break',

    continue_statement: _ => 'continue',

    assignment_statement: $ => seq(
      field('left', $._expression),
      field('operator', choice(
        '=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=',
        seq('>', token.immediate('>=')),
      )),
      field('right', $._expression),
    ),

    update_statement: $ => seq(
      field('operand', $._expression),
      field('operator', choice('++', '--')),
    ),

    expression_statement: $ => $._expression,

    if_statement: $ => seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.block),
      optional(seq('else', field('alternative', choice($.block, $.if_statement)))),
    ),

    for_statement: $ => seq(
      'for',
      optional(seq(
        '(',
        choice(
          field('condition', $._expression),
          $.for_in_clause,
          $.for_clause,
        ),
        ')',
      )),
      field('body', $.block),
    ),

    for_in_clause: $ => seq(
      $.for_binding,
      optional(seq(',', $.for_binding)),
      'in',
      field('value', $._expression),
    ),

    for_binding: $ => seq(
      optional('ref'),
      field('type', $._type),
      field('name', $.identifier),
    ),

    for_clause: $ => seq(
      optional(field('initializer', choice($.variable_declaration, $._simple_statement))),
      ';',
      optional(field('condition', $._expression)),
      ';',
      optional(field('update', $._simple_statement)),
    ),

    switch_statement: $ => seq(
      'switch',
      optional(seq('(', field('value', $._expression), ')')),
      field('body', $.switch_body),
    ),

    switch_body: $ => seq('{', repeat(choice($.case_clause, $.default_clause)), '}'),

    case_clause: $ => seq(
      'case',
      commaSep1($.case_pattern),
      field('body', $.block),
    ),

    default_clause: $ => seq('default', field('body', $.block)),

    case_pattern: $ => choice(
      seq(field('name', $.identifier), optional(field('bindings', $.pattern_bindings))),
      field('value', choice(
        $.integer_literal,
        $.char_literal,
        $.string_literal,
        alias($._negative_literal, $.unary_expression),
      )),
    ),

    _negative_literal: $ => seq(field('operator', '-'), field('operand', $.integer_literal)),

    pattern_bindings: $ => seq('(', commaSep($.pattern_binding), ')'),

    pattern_binding: $ => seq(
      optional('ref'),
      field('type', $._type),
      field('name', $.identifier),
    ),

    try_statement: $ => seq(
      'try',
      field('body', $.block),
      repeat($.catch_clause),
      optional($.finally_clause),
    ),

    catch_clause: $ => seq(
      'catch',
      '(',
      field('type', $._type),
      field('name', $.identifier),
      ')',
      field('body', $.block),
    ),

    finally_clause: $ => seq('finally', field('body', $.block)),

    // ---- Expressions ----

    _expression: $ => choice(
      $.conditional_expression,
      $._or_expression,
    ),

    conditional_expression: $ => seq(
      field('condition', $._or_expression),
      '?',
      field('consequence', $._expression),
      ':',
      field('alternative', $._expression),
    ),

    ...binaryRules,

    _unary_expression: $ => choice(
      $.unary_expression,
      $.ref_expression,
      $.move_expression,
      $._postfix_expression,
    ),

    unary_expression: $ => seq(
      field('operator', choice('-', '!')),
      field('operand', $._unary_expression),
    ),

    ref_expression: $ => seq('ref', field('operand', $._postfix_expression)),

    move_expression: $ => seq('move', field('operand', $._postfix_expression)),

    _postfix_expression: $ => choice(
      $.call_expression,
      $.field_expression,
      $.index_expression,
      $._primary_expression,
    ),

    call_expression: $ => choice(
      seq(
        field('function', $._postfix_expression),
        field('arguments', $.arguments),
      ),
      seq(
        field('function', choice($.identifier, $.field_expression)),
        field('type_arguments', $.type_arguments),
        field('arguments', $.arguments),
      ),
    ),

    arguments: $ => seq('(', commaSep($._expression), ')'),

    field_expression: $ => seq(
      field('object', choice($._postfix_expression, $.generic_type)),
      '.',
      field('field', $.identifier),
    ),

    index_expression: $ => seq(
      field('object', $._postfix_expression),
      '[',
      field('index', $._expression),
      ']',
    ),

    _primary_expression: $ => choice(
      $.identifier,
      $.integer_literal,
      $.float_literal,
      $.char_literal,
      $.string_literal,
      $.boolean_literal,
      $.parenthesized_expression,
      $.list_literal,
      $.lambda_expression,
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    list_literal: $ => seq(
      '[',
      optional(seq(commaSep1($._expression), optional(','))),
      ']',
    ),

    lambda_expression: $ => seq(
      field('captures', $.capture_list),
      field('parameters', $.parameter_list),
      optional(field('return_type', $._type)),
      field('body', $.block),
    ),

    capture_list: $ => seq('[', commaSep($.capture), ']'),

    capture: $ => seq(
      optional(choice('ref', 'move')),
      field('name', $.identifier),
    ),

    // ---- Tokens ----

    boolean_literal: _ => choice('true', 'false'),

    integer_literal: _ => token(choice(
      /0[xX][0-9a-fA-F_]+/,
      /0[bB][01_]+/,
      /[0-9][0-9_]*/,
    )),

    float_literal: _ => token(choice(
      /[0-9][0-9_]*\.[0-9][0-9_]*([eE][+-]?[0-9]+)?/,
      /[0-9][0-9_]*[eE][+-]?[0-9]+/,
    )),

    char_literal: _ => token(seq(
      '\'',
      choice(/[^'\\\n]/, /\\x[0-9a-fA-F]{2}/, /\\[^\n]/),
      '\'',
    )),

    string_literal: $ => seq(
      '"',
      repeat(choice($.string_content, $.escape_sequence, $.placeholder)),
      token.immediate('"'),
    ),

    // A brace alone is text; `{}`, `{0}` and `{:x}` are the placeholders of
    // format, print and println.
    string_content: _ => choice(
      token.immediate(prec(1, /[^"\\\n{}]+/)),
      token.immediate(/[{}]/),
    ),

    placeholder: _ => token.immediate(/\{[0-9]*(:[^{}"\n]*)?\}/),

    escape_sequence: _ => token.immediate(choice(
      /\\x[0-9a-fA-F]{2}/,
      /\\u\{[0-9a-fA-F]+\}/,
      /\\[^\n]/,
      '{{',
      '}}',
    )),

    identifier: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    comment: _ => token(choice(
      seq('//', /[^\n]*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
  },
});
