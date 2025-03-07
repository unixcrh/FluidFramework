/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
import {
	ApiClass,
	ApiDeclaredItem,
	ApiDocumentedItem,
	ApiInterface,
	ApiItem,
	ApiItemKind,
	ApiReturnTypeMixin,
	Excerpt,
	ExcerptTokenKind,
	HeritageType,
	IResolveDeclarationReferenceResult,
	TypeParameter,
} from "@microsoft/api-extractor-model";
import { DocSection } from "@microsoft/tsdoc";

import { Heading } from "../../Heading";
import {
	AlertKind,
	AlertNode,
	DocumentationNode,
	FencedCodeBlockNode,
	HeadingNode,
	LinkNode,
	ParagraphNode,
	PlainTextNode,
	SectionNode,
	SingleLineDocumentationNode,
	SingleLineSpanNode,
	SpanNode,
} from "../../documentation-domain";
import { injectSeparator } from "../../utilities";
import {
	ApiFunctionLike,
	doesItemKindRequireOwnDocument,
	doesItemRequireOwnDocument,
	getAncestralHierarchy,
	getDeprecatedBlock,
	getExampleBlocks,
	getLinkForApiItem,
	getQualifiedApiItemName,
	getReturnsBlock,
	getSeeBlocks,
	getThrowsBlocks,
} from "../ApiItemUtilities";
import { transformDocSection } from "../DocNodeTransforms";
import { getDocNodeTransformationOptions } from "../Utilities";
import { ApiItemTransformationConfiguration } from "../configuration";
import { createParametersSummaryTable, createTypeParametersSummaryTable } from "./TableHelpers";

/**
 * Generates a section for an API signature.
 *
 * @remarks Displayed as a heading with a code-block under it.
 *
 * @param apiItem - The API item whose signature will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if there was any signature content to render, otherwise `undefined`.
 */
export function createSignatureSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	if (apiItem instanceof ApiDeclaredItem) {
		const signatureExcerpt = apiItem.getExcerptWithModifiers();
		if (signatureExcerpt !== "") {
			const contents: DocumentationNode[] = [];

			contents.push(
				FencedCodeBlockNode.createFromPlainText(signatureExcerpt.trim(), "typescript"),
			);

			const renderedHeritageTypes = createHeritageTypesParagraph(apiItem, config);
			if (renderedHeritageTypes !== undefined) {
				contents.push(renderedHeritageTypes);
			}

			return wrapInSection(contents, {
				title: "Signature",
				id: `${getQualifiedApiItemName(apiItem)}-signature`,
			});
		}
	}
	return undefined;
}

/**
 * Generates a section for an API item's {@link https://tsdoc.org/pages/tags/see/ | @see} comment blocks.
 *
 * @remarks Displayed as a "See also" heading, followed by the contents of the API item's `@see` comment blocks
 * merged into a single section.
 *
 * @param apiItem - The API item whose `@see` comment blocks will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if there was any signature content to render, otherwise `undefined`.
 */
export function createSeeAlsoSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	const seeBlocks = getSeeBlocks(apiItem);
	if (seeBlocks === undefined || seeBlocks.length === 0) {
		return undefined;
	}

	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);

	const contents = seeBlocks.map((seeBlock) =>
		transformDocSection(seeBlock, docNodeTransformOptions),
	);

	return wrapInSection(contents, {
		title: "See Also",
		id: `${getQualifiedApiItemName(apiItem)}-see-also`,
	});
}

/**
 * Renders a section listing types extended / implemented by the API item, if any.
 *
 * @remarks Displayed as a heading with a comma-separated list of heritage types by catagory under it.
 *
 * @param apiItem - The API item whose heritage types will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The paragraph containing heritage type information, if any is present. Otherwise `undefined`.
 */
export function createHeritageTypesParagraph(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): ParagraphNode | undefined {
	const { logger } = config;

	const contents: ParagraphNode[] = [];

	if (apiItem instanceof ApiClass) {
		// Render `extends` type if there is one.
		if (apiItem.extendsType) {
			const extendsTypesSpan = createHeritageTypeListSpan(
				[apiItem.extendsType],
				"Extends",
				config,
			);

			if (extendsTypesSpan === undefined) {
				logger.error(
					'No content was rendered for non-empty "extends" type list. This is not expected.',
				);
			} else {
				contents.push(new ParagraphNode([extendsTypesSpan]));
			}
		}

		// Render `implements` types if there are any.
		const renderedImplementsTypes = createHeritageTypeListSpan(
			apiItem.implementsTypes,
			"Implements",
			config,
		);
		if (renderedImplementsTypes !== undefined) {
			contents.push(new ParagraphNode([renderedImplementsTypes]));
		}

		// Render type parameters if there are any.
		const renderedTypeParameters = createTypeParametersSection(
			apiItem.typeParameters,
			apiItem,
			config,
		);
		if (renderedTypeParameters !== undefined) {
			contents.push(new ParagraphNode([renderedTypeParameters]));
		}
	}

	if (apiItem instanceof ApiInterface) {
		// Render `extends` types if there are any.
		const renderedExtendsTypes = createHeritageTypeListSpan(
			apiItem.extendsTypes,
			"Extends",
			config,
		);
		if (renderedExtendsTypes !== undefined) {
			contents.push(new ParagraphNode([renderedExtendsTypes]));
		}

		// Render type parameters if there are any.
		const renderedTypeParameters = createTypeParametersSection(
			apiItem.typeParameters,
			apiItem,
			config,
		);
		if (renderedTypeParameters !== undefined) {
			contents.push(new ParagraphNode([renderedTypeParameters]));
		}
	}

	if (contents.length === 0) {
		return undefined;
	}

	// If only 1 child paragraph, prevent creating unecessary hierarchy here by not wrapping it.
	if (contents.length === 1) {
		return contents[0];
	}

	return new ParagraphNode(contents);
}

/**
 * Renders a labeled, comma-separated list of heritage types.
 *
 * @remarks Displayed as `<label>: <heritage-type>[, <heritage-type>]*`
 *
 * @param heritageTypes - List of types to display.
 * @param label - Label text to display before the list of types.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 */
function createHeritageTypeListSpan(
	heritageTypes: readonly HeritageType[],
	label: string,
	config: Required<ApiItemTransformationConfiguration>,
): SpanNode | undefined {
	if (heritageTypes.length > 0) {
		const renderedLabel = SpanNode.createFromPlainText(`${label}: `, { bold: true });

		// Build up array of excerpt entries
		const renderedHeritageTypes: SpanNode[] = [];
		for (const heritageType of heritageTypes) {
			const renderedExcerpt = createExcerptSpanWithHyperlinks(heritageType.excerpt, config);
			if (renderedExcerpt !== undefined) {
				renderedHeritageTypes.push(renderedExcerpt);
			}
		}

		const renderedList = injectSeparator<DocumentationNode>(
			renderedHeritageTypes,
			new PlainTextNode(", "),
		);

		return new SpanNode([renderedLabel, ...renderedList]);
	}
	return undefined;
}

/**
 * Renders a section describing the type parameters..
 * I.e. {@link https://tsdoc.org/pages/tags/typeparam/ | @typeParam} comment blocks.
 *
 * @remarks Displayed as a labeled, comma-separated list of types.
 * Links will be generated for types that are a part of the same API suite (model).
 *
 * @param typeParameters - List of type parameters associated with some API item.
 * @param contextApiItem - The API item with which the example is associated.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if any type parameters were provided, otherwise `undefined`.
 */
export function createTypeParametersSection(
	typeParameters: readonly TypeParameter[],
	contextApiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	if (typeParameters.length === 0) {
		return undefined;
	}

	const typeParamTable = createTypeParametersSummaryTable(typeParameters, contextApiItem, config);

	return new SectionNode([typeParamTable], HeadingNode.createFromPlainText("Type Parameters"));
}

/**
 * Renders a doc paragraph for the provided TSDoc excerpt.
 *
 * @remarks This function is a helper to parse TSDoc excerpt token syntax into documentation with the appropriate links.
 * It will generate links to any API members that are a part of the same API suite (model). Other token contents
 * will be rendered as plain text.
 *
 * @param excerpt - The TSDoc excerpt to render.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns A span containing the rendered contents, if non-empty.
 * Otherwise, will return `undefined`.
 */
export function createExcerptSpanWithHyperlinks(
	excerpt: Excerpt,
	config: Required<ApiItemTransformationConfiguration>,
): SingleLineSpanNode | undefined {
	if (excerpt.isEmpty) {
		return undefined;
	}

	const children: SingleLineDocumentationNode[] = [];
	for (const token of excerpt.spannedTokens) {
		// Markdown doesn't provide a standardized syntax for hyperlinks inside code spans, so we will render
		// the type expression as DocPlainText.  Instead of creating multiple DocParagraphs, we can simply
		// discard any newlines and let the renderer do normal word-wrapping.
		const unwrappedTokenText: string = token.text.replace(/[\n\r]+/g, " ");

		let wroteHyperlink = false;

		// If it's hyperlink-able, then append a DocLinkTag
		if (token.kind === ExcerptTokenKind.Reference && token.canonicalReference) {
			const apiItemResult: IResolveDeclarationReferenceResult =
				// eslint-disable-next-line unicorn/no-useless-undefined
				config.apiModel.resolveDeclarationReference(token.canonicalReference, undefined);

			if (apiItemResult.resolvedApiItem) {
				const link = getLinkForApiItem(
					apiItemResult.resolvedApiItem,
					config,
					unwrappedTokenText,
				);
				children.push(LinkNode.createFromPlainTextLink(link));
				wroteHyperlink = true;
			}
		}

		// If the token was not one from which we generated hyperlink text, write as plain text instead
		if (!wroteHyperlink) {
			children.push(new PlainTextNode(unwrappedTokenText));
		}
	}

	return new SingleLineSpanNode(children);
}

/**
 * Renders a simple navigation breadcrumb.
 *
 * @remarks Displayed as a ` > `-separated list of hierarchical page links.
 * 1 for each element in the provided item's ancestory for which a separate document is generated
 * (see {@link DocumentBoundaries}).
 *
 * @param apiItem - The API item whose ancestory will be used to generate the breadcrumb.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 */
export function createBreadcrumbParagraph(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): ParagraphNode {
	// Get ordered ancestry of document items
	const ancestry = getAncestralHierarchy(apiItem, (hierarchyItem) =>
		doesItemRequireOwnDocument(hierarchyItem, config.documentBoundaries),
	).reverse(); // Reverse from ascending to descending order

	const breadcrumbSeparator = new PlainTextNode(" > ");

	const contents: DocumentationNode[] = [];

	// Render ancestry links
	let writtenAnythingYet = false;
	for (const hierarchyItem of ancestry) {
		// TODO: join helper?
		if (writtenAnythingYet) {
			contents.push(breadcrumbSeparator);
		}
		contents.push(LinkNode.createFromPlainTextLink(getLinkForApiItem(hierarchyItem, config)));

		writtenAnythingYet = true;
	}

	// Render entry for the item itself
	if (writtenAnythingYet) {
		contents.push(breadcrumbSeparator);
	}
	contents.push(LinkNode.createFromPlainTextLink(getLinkForApiItem(apiItem, config)));

	return new ParagraphNode(contents);
}

/**
 * Alert text used in {@link betaAlert}.
 */
const betaWarning: string =
	"This API is provided as a preview for developers and may change" +
	" based on feedback that we receive. Do not use this API in a production environment.";

/**
 * A simple alert containing a warning about using `@beta` APIs.
 */
export const betaAlert = new AlertNode(
	[ParagraphNode.createFromPlainText(betaWarning)],
	AlertKind.Danger,
);

/**
 * Renders a section containing the API item's summary comment if it has one.
 */
export function createSummaryParagraph(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): ParagraphNode | undefined {
	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);
	return apiItem instanceof ApiDocumentedItem && apiItem.tsdocComment !== undefined
		? transformDocSection(apiItem.tsdocComment.summarySection, docNodeTransformOptions)
		: undefined;
}

/**
 * Renders a section containing the {@link https://tsdoc.org/pages/tags/remarks/ | @remarks} documentation of the
 * provided API item, if it has any.
 *
 * @remarks Displayed as a heading, with the documentation contents under it.
 *
 * @param apiItem - The API item whose `@remarks` documentation will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the API item had a `@remarks` comment, otherwise `undefined`.
 */
export function createRemarksSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	if (
		!(apiItem instanceof ApiDocumentedItem) ||
		apiItem.tsdocComment?.remarksBlock === undefined
	) {
		return undefined;
	}

	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);

	return wrapInSection(
		[transformDocSection(apiItem.tsdocComment.remarksBlock.content, docNodeTransformOptions)],
		{ title: "Remarks", id: `${getQualifiedApiItemName(apiItem)}-remarks` },
	);
}

/**
 * Renders a section containing the {@link https://tsdoc.org/pages/tags/throws/ | @throws} documentation of the
 * provided API item, if it has any.
 *
 * @remarks Displayed as a heading, with the documentation contents under it.
 *
 * @param apiItem - The API item whose `@throws` documentation will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the API item had any `@throws` comments, otherwise `undefined`.
 */
export function createThrowsSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	const throwsBlocks = getThrowsBlocks(apiItem);
	if (throwsBlocks === undefined || throwsBlocks.length === 0) {
		return undefined;
	}

	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);

	const paragraphs = throwsBlocks.map((throwsBlock) =>
		transformDocSection(throwsBlock, docNodeTransformOptions),
	);

	return wrapInSection(paragraphs, {
		title: "Throws",
		id: `${getQualifiedApiItemName(apiItem)}-throws`,
	});
}

/**
 * Renders a section containing the {@link https://tsdoc.org/pages/tags/deprecated/ | @deprecated} notice documentation
 * of the provided API item if it has any.
 *
 * @remarks Displayed as a simple note box containing the deprecation notice comment.
 *
 * @param apiItem - The API item whose `@deprecated` documentation will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the API item had a `@remarks` comment, otherwise `undefined`.
 */
export function createDeprecationNoticeSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): AlertNode | undefined {
	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);

	const deprecatedBlock = getDeprecatedBlock(apiItem);
	if (deprecatedBlock === undefined) {
		return undefined;
	}

	return new AlertNode(
		[transformDocSection(deprecatedBlock, docNodeTransformOptions)],
		AlertKind.Warning,
		"Deprecated",
	);
}

/**
 * Renders a section containing any {@link https://tsdoc.org/pages/tags/example/ | @example} documentation of the
 * provided API item if it has any.
 *
 * @remarks Displayed as 1 or more headings (1 for each example), with the example contents under them.
 * If there is more than 1 example comment, each example will be parented under a numbered heading under
 * an "Examples" heading.
 * If there is only 1 example comment, that comment will be rendered under a single "Example" heading.
 *
 * @param apiItem - The API item whose `@example` documentation will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the API item had any `@example` comment blocks, otherwise `undefined`.
 */
export function createExamplesSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	const exampleBlocks = getExampleBlocks(apiItem);

	if (exampleBlocks === undefined || exampleBlocks.length === 0) {
		return undefined;
	}

	// If there is only 1 example, render it with a single default (un-numbered) heading
	if (exampleBlocks.length === 1) {
		return createExampleSection({ apiItem, content: exampleBlocks[0] }, config);
	}

	const exampleSections: SectionNode[] = [];
	for (const [i, exampleBlock] of exampleBlocks.entries()) {
		exampleSections.push(
			createExampleSection({ apiItem, content: exampleBlock, exampleNumber: i + 1 }, config),
		);
	}

	return wrapInSection(exampleSections, {
		title: "Examples",
		id: `${getQualifiedApiItemName(apiItem)}-examples`,
	});
}

/**
 * Represents a single {@link https://tsdoc.org/pages/tags/example/ | @example} comment block for a given API item.
 */
export interface DocExampleProperties {
	/**
	 * The API item the example doc content belongs to.
	 */
	apiItem: ApiItem;

	/**
	 * `@example` comment body.
	 */
	content: DocSection;

	/**
	 * Example number. Used to disambiguate multiple `@example` comment headings numerically.
	 * If not specified, example heading will not be labeled with a number.
	 */
	exampleNumber?: number;
}

/**
 * Renders a section containing a single {@link https://tsdoc.org/pages/tags/example/ | @example} documentation comment.
 *
 * @remarks Displayed as a heading with the example comment under it.
 *
 * @param example - The example to render.
 * @param contextApiItem - The API item with which the example is associated.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 */
export function createExampleSection(
	example: DocExampleProperties,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode {
	const docNodeTransformOptions = getDocNodeTransformationOptions(example.apiItem, config);

	const headingTitle: string =
		example.exampleNumber === undefined ? "Example" : `Example ${example.exampleNumber}`;

	const headingId = `${getQualifiedApiItemName(example.apiItem)}-example${
		example.exampleNumber === undefined ? "" : example.exampleNumber
	}`;

	return wrapInSection([transformDocSection(example.content, docNodeTransformOptions)], {
		title: headingTitle,
		id: headingId,
	});
}

/**
 * Renders a section describing the list of parameters (if any) of a function-like API item.
 *
 * @remarks Displayed as a heading with a table representing the different parameters under it.
 *
 * @param apiFunctionLike - The function-like API item whose parameters will be described.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the item had any parameters, otherwise `undefined`.
 */
export function createParametersSection(
	apiFunctionLike: ApiFunctionLike,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	if (apiFunctionLike.parameters.length === 0) {
		return undefined;
	}

	return wrapInSection(
		[createParametersSummaryTable(apiFunctionLike.parameters, apiFunctionLike, config)],
		{
			title: "Parameters",
			id: `${getQualifiedApiItemName(apiFunctionLike)}-parameters`,
		},
	);
}

/**
 * Renders a section containing the {@link https://tsdoc.org/pages/tags/returns/ | @returns} documentation of the
 * provided API item, if it has one.
 *
 * @remarks Displayed as a heading, with the documentation contents and the return type under it.
 *
 * @param apiItem - The API item whose `@returns` documentation will be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 *
 * @returns The doc section if the API item had a `@returns` comment, otherwise `undefined`.
 */
export function createReturnsSection(
	apiItem: ApiItem,
	config: Required<ApiItemTransformationConfiguration>,
): SectionNode | undefined {
	const docNodeTransformOptions = getDocNodeTransformationOptions(apiItem, config);

	const children: DocumentationNode[] = [];

	// Generate span from `@returns` comment
	if (apiItem instanceof ApiDocumentedItem && apiItem.tsdocComment !== undefined) {
		const returnsBlock = getReturnsBlock(apiItem);
		if (returnsBlock !== undefined) {
			children.push(transformDocSection(returnsBlock, docNodeTransformOptions));
		}
	}

	// Generate paragraph with notes about the return type
	if (ApiReturnTypeMixin.isBaseClassOf(apiItem) && apiItem.returnTypeExcerpt.text.trim() !== "") {
		// Special case to detect when the return type is `void`.
		// We will skip declaring the return type in this case.
		// eslint-disable-next-line unicorn/no-lonely-if
		if (apiItem.returnTypeExcerpt.text.trim() !== "void") {
			const typeExcerptSpan = createExcerptSpanWithHyperlinks(
				apiItem.returnTypeExcerpt,
				config,
			);
			if (typeExcerptSpan !== undefined) {
				children.push(
					new ParagraphNode([
						SpanNode.createFromPlainText("Return type: ", { bold: true }),
						typeExcerptSpan,
					]),
				);
			}
		}
	}

	return children.length === 0
		? undefined
		: wrapInSection(children, {
				title: "Returns",
				id: `${getQualifiedApiItemName(apiItem)}-returns`,
		  });
}

/**
 * Represents a series API child items for which documentation sections will be generated.
 */
export interface ChildSectionProperties {
	/**
	 * Heading for the section being rendered.
	 */
	heading: Heading;

	/**
	 * The API item kind of all child items.
	 */
	itemKind: ApiItemKind;

	/**
	 * The child items to be rendered.
	 *
	 * @remarks Every item's `kind` must be `itemKind`.
	 */
	items: readonly ApiItem[];
}

/**
 * Renders a section describing child items of some API item, grouped by `kind`.
 *
 * @remarks Displayed as a series of subsequent sub-sections.
 *
 * Note: Rendering here will skip any items intended to be rendered to their own documents
 * (see {@link DocumentBoundaries}).
 * The assumption is that this is used to render child contents to the same document as the parent.
 *
 * @param childItems - The child sections to be rendered.
 * @param config - See {@link ApiItemTransformationConfiguration}.
 * @param createChildContent - Callback to render a given child item.
 *
 * @returns The doc section if there were any child contents to render, otherwise `undefined`.
 */
export function createChildDetailsSection(
	childItems: readonly ChildSectionProperties[],
	config: Required<ApiItemTransformationConfiguration>,
	createChildContent: (apiItem) => DocumentationNode[],
): SectionNode[] | undefined {
	const sections: SectionNode[] = [];

	for (const childItem of childItems) {
		// Only render contents for a section if the item kind is one that gets rendered to its parent's document
		// (i.e. it does not get rendered to its own document).
		// Also only render the section if it actually has contents to render (to avoid empty headings).
		if (
			!doesItemKindRequireOwnDocument(childItem.itemKind, config.documentBoundaries) &&
			childItem.items.length > 0
		) {
			const childContents: DocumentationNode[] = [];
			for (const item of childItem.items) {
				childContents.push(...createChildContent(item));
			}

			sections.push(wrapInSection(childContents, childItem.heading));
		}
	}

	return sections.length === 0 ? undefined : sections;
}

/**
 * Wraps the provided contents in a {@link SectionNode}.
 * @param nodes - The section's child contents.
 * @param heading - Optional heading to associate with the section.
 */
export function wrapInSection(nodes: DocumentationNode[], heading?: Heading): SectionNode {
	return new SectionNode(
		nodes,
		heading ? HeadingNode.createFromPlainTextHeading(heading) : undefined,
	);
}
