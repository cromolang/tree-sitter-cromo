// External scanner for Cromo: the newline that ends a statement.
//
// Cromo has no ';'. A line break ends a statement, except where the grammar
// cannot end one (after a binary operator, a comma, inside parentheses or
// brackets, after '{'): there the parser does not ask for a newline and the
// line break is plain whitespace. This scanner adds the cases that need to
// look at what follows the line break:
//
//   - '{' may open a body on the next line;
//   - 'else', 'catch' and 'finally' may start on the line after a '}';
//   - the end of the file ends the last statement.

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType {
    NEWLINE,
    ERROR_SENTINEL,
};

void *tree_sitter_cromo_external_scanner_create(void) { return NULL; }
void tree_sitter_cromo_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_cromo_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}
void tree_sitter_cromo_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

static bool is_ident_char(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
}

// True if the text ahead is one of the words that continue a statement after
// the line break: else, catch, finally.
static bool continues_with_word(TSLexer *lexer) {
    static const char *const words[] = {"else", "catch", "finally"};
    char word[9];
    unsigned length = 0;
    while (is_ident_char(lexer->lookahead)) {
        if (length >= 8) return false;
        word[length++] = (char)lexer->lookahead;
        lexer->advance(lexer, false);
    }
    word[length] = '\0';
    for (unsigned i = 0; i < 3; ++i) {
        const char *a = words[i];
        const char *b = word;
        while (*a && *a == *b) {
            ++a;
            ++b;
        }
        if (*a == '\0' && *b == '\0') return true;
    }
    return false;
}

bool tree_sitter_cromo_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;
    if (!valid_symbols[NEWLINE]) return false;
    bool recovering = valid_symbols[ERROR_SENTINEL];

    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') {
        lexer->advance(lexer, true);
    }
    if (lexer->eof(lexer)) {
        if (recovering) return false;
        lexer->mark_end(lexer);
        lexer->result_symbol = NEWLINE;
        return true;
    }
    if (lexer->lookahead != '\n') return false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    lexer->result_symbol = NEWLINE;

    // Look past the blank lines and the comments at what comes next.
    for (;;) {
        int32_t c = lexer->lookahead;
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
            lexer->advance(lexer, false);
        } else if (c == '/') {
            lexer->advance(lexer, false);
            if (lexer->lookahead == '/') {
                while (!lexer->eof(lexer) && lexer->lookahead != '\n') lexer->advance(lexer, false);
            } else if (lexer->lookahead == '*') {
                lexer->advance(lexer, false);
                int32_t previous = 0;
                while (!lexer->eof(lexer) && !(previous == '*' && lexer->lookahead == '/')) {
                    previous = lexer->lookahead;
                    lexer->advance(lexer, false);
                }
                if (!lexer->eof(lexer)) lexer->advance(lexer, false);
            } else {
                return true;
            }
        } else {
            break;
        }
    }
    if (lexer->lookahead == '{') return false;
    if (continues_with_word(lexer)) return false;
    return true;
}
