import { ContentSettings } from '@main/index';
import fs from 'fs';
import { createClient } from 'contentful';
import { removeLeadingAndTrailingSlashes } from '@helpers/strings';
import processEntry from './processEntry';
import { ConfigContentfulSettings } from './config/src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mkdirp = require('mkdirp');

interface ContentfulClientQuery {
    [key: string]: string | number | undefined | boolean;
    // eslint-disable-next-line camelcase
    content_type?: string;
    limit?: number;
    skip?: number;
    order?: string;
    'sys.id'?: string;
}

/// get content for a single content type ///
// itemsPulled refers to entries that have already been called it's used in conjunction with skip for pagination
const getContentType = async (
    limit: number,
    skip: number,
    contentSettings: ContentSettings,
    contentfulSettings: ConfigContentfulSettings,
    previewMode = false,
    itemsPulled?: number
): Promise<{
    totalItems: number;
    typeId: string;
}> => {
    const { token, previewToken, space, environment } = contentfulSettings;
    if (previewMode && !previewToken) {
        throw new Error(
            'Environment variable CONTENTFUL_PREVIEW_TOKEN not set'
        );
    } else if (!previewMode && !token) {
        throw new Error('Environment variable CONTENTFUL_TOKEN not set');
    }
    let accessToken = token;
    if (previewMode) {
        accessToken = previewToken || token || '';
    }
    const options = {
        space,
        host: previewMode ? 'preview.contentful.com' : 'cdn.contentful.com',
        accessToken,
        environment,
    };
    const client = createClient(options);
    // check for file extension default to markdown
    if (!contentSettings.fileExtension) {
        contentSettings.fileExtension = 'md';
    }
    const query: ContentfulClientQuery = {
        content_type: contentSettings.typeId,
        limit,
        skip,
        order: 'sys.updatedAt',
    };
    if (contentSettings.filters) {
        const { filters } = contentSettings;
        const ignoreKeys = ['content_type', 'limit', 'skip'];
        Object.keys(filters).forEach(key => {
            if (!ignoreKeys.includes(key)) {
                query[key] = filters[key];
            }
        });
    }
    return client.getEntries(query).then(data => {
        // variable for counting number of items pulled
        let itemCount;
        if (itemsPulled) {
            itemCount = itemsPulled;
        } else {
            itemCount = 0;
        }
        // create directory for file
        const newDir = `./${removeLeadingAndTrailingSlashes(
            contentSettings.directory
        )}`;
        mkdirp.sync(newDir);
        if (contentSettings.isHeadless && !contentSettings.isSingle) {
            const listPageFrontMatter = `---\n# this is a work-around to prevent hugo from rendering a list page\nurl: /\n---\n`;
            fs.writeFileSync(`${newDir}/_index.md`, listPageFrontMatter);
        }

        for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i];
            processEntry(item, contentSettings);
            itemCount++;
        }

        // check total number of items against number of items pulled in API
        if (data.total > data.limit && !contentSettings.isSingle) {
            // run function again if there are still more items to get
            const newSkip = skip + limit;
            return getContentType(
                limit,
                newSkip,
                contentSettings,
                contentfulSettings,
                previewMode,
                itemCount
            );
        }
        return {
            totalItems: itemCount,
            typeId: contentSettings.typeId,
        };
    });
};

export default getContentType;
