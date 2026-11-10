import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loginManualSchema, loginManual, getSessionStatusSchema, getSessionStatus, logoutSchema, logout } from './tools/session.js';
import {
  readCurrentPageSchema,
  readCurrentPage,
  saveAndContinueSchema,
  saveAndContinue,
  navigateSectionSchema,
  navigateSection,
  expectPageSchema,
  expectPage,
  listSectionsSchema,
  listSections,
} from './tools/page.js';
import { fillFieldsSchema, fillFields, clickButtonSchema, clickButton } from './tools/generic.js';
import { fillTaxpayerInfoSchema, fillTaxpayerInfo, fillFilingStatusSchema, fillFilingStatus } from './tools/personal.js';
import { getTaxSummarySchema, getTaxSummary, getRefundEstimateSchema, getRefundEstimate } from './tools/overview.js';
import { filterPII, redactPII } from './security/pii-filter.js';

const MAX_ERROR_MESSAGE = 200;

/**
 * First line of an error message only, capped in length. Playwright errors
 * append a multi-line call log with selectors and page state; that stays in
 * the server log.
 */
export function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split('\n')[0].trim() || 'Unexpected error';
  return firstLine.length > MAX_ERROR_MESSAGE ? `${firstLine.slice(0, MAX_ERROR_MESSAGE)}…` : firstLine;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function createServer(): McpServer {
  const server = new McpServer({ name: 'freetaxusa-mcp', version: '1.1.0' });

  function wrap(handler: ToolHandler) {
    return async (args: Record<string, unknown>) => {
      try {
        const result = await handler(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(filterPII(result), null, 2) }] };
      } catch (err) {
        // Full detail (Playwright call logs, selectors, stack) goes to stderr
        // for the operator; the client only gets a short, redacted summary.
        const raw = err instanceof Error ? (err.stack ?? err.message) : String(err);
        process.stderr.write(`[freetaxusa-mcp] tool error: ${redactPII(raw)}\n`);
        const message = summarizeError(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(filterPII({ success: false, error: 'internal_error', message }), null, 2) }],
          isError: true,
        };
      }
    };
  }

  server.tool(
    'login_manual',
    'Open FreeTaxUSA in the visible browser for the user to sign in by hand. Never ask the user for their password. Returns waiting_for_user if they are still signing in; call again after they finish.',
    loginManualSchema.shape,
    wrap(args => {
      loginManualSchema.parse(args);
      return loginManual();
    }),
  );

  server.tool(
    'logout',
    'End the FreeTaxUSA session: sign out, close the browser, and delete the saved browser profile and cookies.',
    logoutSchema.shape,
    wrap(args => logout(logoutSchema.parse(args))),
  );

  server.tool('get_session_status', 'Check whether the FreeTaxUSA session is active and which tax year and section is loaded.', getSessionStatusSchema.shape, wrap(args => { getSessionStatusSchema.parse(args); return getSessionStatus(); }));

  server.tool('list_sections', 'List the sections discovered in the FreeTaxUSA sidebar with their SID numbers.', listSectionsSchema.shape, wrap(args => listSections(listSectionsSchema.parse(args))));

  server.tool(
    'navigate_section',
    'Jump to a section by name (e.g., "income", "deductions", "personal info") or SID number. Save the current page first; navigating discards unsaved edits.',
    {
      section: z.string().optional().describe('Section name'),
      sid: z.number().optional().describe('Direct SID number'),
    },
    wrap(args => navigateSection(navigateSectionSchema.parse(args))),
  );

  server.tool('expect_page', 'Check that the current page heading or title contains the given text. Use before filling fields.', expectPageSchema.shape, wrap(args => expectPage(expectPageSchema.parse(args))));

  server.tool('read_current_page', 'Read all form fields and their values on the current FreeTaxUSA page.', readCurrentPageSchema.shape, wrap(args => { readCurrentPageSchema.parse(args); return readCurrentPage(); }));

  server.tool(
    'fill_fields',
    'Fill one or more fields on the current page by their accessible label (from read_current_page). Works on any page: W-2, 1099, deductions. Does not save; call save_and_continue afterward. Refuses filing, payment and card fields.',
    fillFieldsSchema.shape,
    wrap(args => fillFields(fillFieldsSchema.parse(args))),
  );

  server.tool(
    'click_button',
    'Click a button or link on the current page by its text (e.g. "Add a W-2", "Edit"). Refuses filing, purchase and payment actions.',
    clickButtonSchema.shape,
    wrap(args => clickButton(clickButtonSchema.parse(args))),
  );

  server.tool('save_and_continue', 'Submit the current FreeTaxUSA page and advance to the next page. Refuses on filing and payment pages.', saveAndContinueSchema.shape, wrap(args => { saveAndContinueSchema.parse(args); return saveAndContinue(); }));

  server.tool(
    'fill_taxpayer_info',
    'Navigate to the taxpayer personal information page and fill name, SSN, DOB, address and occupation. Does not save.',
    fillTaxpayerInfoSchema.shape,
    wrap(args => fillTaxpayerInfo(fillTaxpayerInfoSchema.parse(args))),
  );

  server.tool(
    'fill_filing_status',
    'Navigate to the filing status page and select single, married_joint, married_separate, head_of_household or qualifying_widow. Does not save.',
    fillFilingStatusSchema.shape,
    wrap(args => fillFilingStatus(fillFilingStatusSchema.parse(args))),
  );

  server.tool('get_tax_summary', 'Navigate to the summary page and read refund or amount owed, AGI and filing status. Confirm figures in the browser.', getTaxSummarySchema.shape, wrap(args => { getTaxSummarySchema.parse(args); return getTaxSummary(); }));

  server.tool('get_refund_estimate', 'Read the running federal and state refund or amount owed from the current page. Confirm figures in the browser.', getRefundEstimateSchema.shape, wrap(args => { getRefundEstimateSchema.parse(args); return getRefundEstimate(); }));

  return server;
}
