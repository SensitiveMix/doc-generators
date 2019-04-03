﻿'use strict';

// Dependencies
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const parser = require('swagger-parser');
const swaggerHelpers = require('./swagger-helpers');
const doctrine = require('doctrine')

/**
 * Parses the provided API file for JSDoc comments.
 * @function
 * @param {string} file - File to be parsed
 * @returns {object} JSDoc comments
 * @requires doctrine
 */
function parseApiFile(file) {
    const lines = fs.readFileSync(file, 'utf-8').split(/[\n\r]/).filter(Boolean);
    //let commentMap = [];
    let commentArray = [];
    let parsedComments = [];
    let commentStartIndex = 0;
    let commentEndIndex = 0;

    for (let i = 0, len = lines.length; i < len; i++) {
        // Check if we got a comment to parse
        if(commentStartIndex !== 0 && commentEndIndex !== 0) {
            //commentMap.push([commentStartIndex, commentEndIndex]);
            let j = commentStartIndex;
            while(j <= commentEndIndex)
            {
                commentArray.push(lines[j].trim());
                j++;
            }

            // Parse comment block
            parsedComments.push(doctrine.parse(commentArray.join('\n'), {unwrap: true, sloppy: true, tags: null, recoverable: true}));

            // Reset comment array
            commentArray = [];

            // Reset indexes
            commentStartIndex = 0;
            commentEndIndex = 0;
        }

        // We just found a new comment starting point
        if(commentStartIndex === 0 && commentEndIndex === 0 && lines[i].trim() === "/**")
            commentStartIndex = i;
        // Guess this comment ends here
        else if(commentStartIndex !== 0 && commentEndIndex === 0 && lines[i].trim() === "*/")
            commentEndIndex = i;
    }

    return parsedComments;
}

function parseRoute(str) {
    let split = str.split(" ")

    return {
        method: split[0].toLowerCase() || 'get',
        uri: split[1] || ''
    }
}

function parseField(str) {
    let split = str.split(".")
    return {
        name: split[0],
        parameter_type: split[1] || 'get',
        required: split[2] && split[2] === 'required' || false
    }
}

function parseType(obj) {
    if (!obj) return undefined;
    if (obj.name) {
        const spl = obj.name.split('.');
        if (spl.length > 1 && spl[1] == 'model') {
            return spl[0];
        }
        else return obj.name;
    } else if (obj.expression && obj.expression.name) {
        return obj.expression.name.toLowerCase();
    } else {
        return 'string';
    }
}

function parseSchema(obj) {
    if (!(obj.name || obj.applications)) return undefined;

    if (obj.name) {
        const spl = obj.name.split('.');
        if (spl.length > 1 && spl[1] == 'model') {
            return {"$ref": "#/definitions/" + spl[0]};
        }
        else return undefined;
    }
    if (obj.applications) {

        if (obj.applications.length === 1) {
            const type = obj.applications[0].name;
            if (type == 'object' || type == 'string' || type == 'integer' || type == 'boolean') {
                return {
                    type: obj.expression.name.toLowerCase(),
                    items: {
                        "type": type
                    }
                }
            } else {
                return {
                    type: obj.expression.name.toLowerCase(),
                    items: {
                        "$ref": "#/definitions/" + obj.applications[0].name
                    }
                }
            }
        }
        let oneOf = []
        for (let i in obj.applications) {
            const type = obj.applications[i].name;
            if (type == 'object' || type == 'string' || type == 'integer' || type == 'boolean') {
                oneOf.push({
                    "type": type
                })
            } else {
                oneOf.push({
                    "$ref": "#/definitions/" + obj.applications[i].name
                })
            }
            return {
                type: obj.expression.name.toLowerCase(),
                items: {
                    oneOf: oneOf
                }
            }
        }
    }

    return undefined
}

function parseItems(obj) {
    if (obj.applications && obj.applications.length > 0 && obj.applications[0].name) {
        const type = obj.applications[0].name;
        if (type == 'object' || type == 'string' || type == 'integer' || type == 'boolean') {
            return {"type": type}
        }
        else return {"$ref": "#/definitions/" + type};
    }
    else return undefined;
}

function parseReturn(tags) {
    let rets = {}
    let headers = parseHeaders(tags)

    for (let i in tags) {
        if (tags[i]['title'] == 'returns' || tags[i]['title'] == 'return') {
            let description = tags[i]['description'].split("-"), key = description[0].trim()

            rets[key] = {
                description: description[1] ? description[1].trim() : '',
                headers: headers[key]
            };
            const type = parseType(tags[i].type);
            if (type) {
                // rets[key].type = type;
                rets[key].schema = parseSchema(tags[i].type)
            }
        }
    }
    return rets
}

function parseDescription(obj) {
    return obj.description || ''
}

function parseTag(tags) {
    for (let i in tags) {
        if (tags[i]['title'] == 'group') {
            return tags[i]['description'].split("-")
        }
    }
    return ['default', '']
}

function parseProduces(str) {
    return str.split(/\s+/);
}


function parseConsumes(str) {
    return str.split(/\s+/);
}

function parseTypedef(tags) {
    const typeName = tags[0]['name'];
    let details = {
        required: null,
        properties: {}
    };
    if (tags[0].type && tags[0].type.name) {
        details.allOf = [{"$ref": '#/definitions/' + tags[0].type.name}]
    }
    for (let i = 1; i < tags.length; i++) {
        if (tags[i].title == 'property') {
            let propName = tags[i].name;
            const required = propName.split('.')[1];
            if (required && required == 'required') {
                if (details.required == null) details.required = [];
                propName = propName.split('.')[0];
                details.required.push(propName);
            }
            var schema = parseSchema(tags[i].type);
            if (schema) {
                details.properties[propName] = schema;
            } else {
                const type = parseType(tags[i].type);
                const parsedDescription = (tags[i].description || '').split(/-\s*eg:\s*/);
                const description = parsedDescription[0];
                const example = parsedDescription[1];

                let prop = {
                    type: type,
                    description: description,
                    items: parseItems(tags[i].type),
                };
                details.properties[propName] = prop

                if(prop.type == 'enum') {
                    let parsedEnum = parseEnums('-eg:' + example)
                    console.log('-eg:' + example)
                    prop.type = parsedEnum.type
                    prop.enmu = parsedEnum.enums
                }

                if (example) {
                    switch (type) {
                        case 'boolean':
                            details.properties[propName].example = example === 'true' ? true : false;
                            break;
                        case 'integer':
                            details.properties[propName].example = +example;
                            break;
                        case 'enum':
                            break;
                        default:
                            details.properties[propName].example = example;
                            break;
                    }
                }
            }
        }
    }
    return {typeName, details};
}

function parseSecurity(comments) {
    let security;
    try {
        security = JSON.parse(comments)
    } catch (e) {
        let obj = {}
        obj[comments] = []
        security = [
            obj
        ]
    }
    return security
}

function parseHeaders(comments) {
    let headers = {}
    for (let i in comments) {
        if (comments[i]['title'] === 'headers' || comments[i]['title'] === 'header') {

            let description = comments[i]['description'].split(/\s+-\s+/)

            if (description.length < 1) {
                break
            }
            let code2name = description[0].split(".")

            if (code2name.length < 2) {
                break
            }

            let type = code2name[0].match(/\w+/)
            let code = code2name[0].match(/\d+/)

            if (!type || !code) {
                break;
            }
            let code0 = code[0].trim();
            if (!headers[code0]) {
                headers[code0] = {}
            }

            headers[code0][code2name[1]] = {
                type: type[0],
                description: description[1]
            }
        }
    }
    return headers
}

function parseEnums(description) {
    let enums = ('' + description).split(/-\s*eg:\s*/)
    if(enums.length < 2) {
        return []
    }
    let parseType = enums[1].split(":")
    if(parseType.length === 1) {
        parseType = ['string', parseType[0]]
    }
    return {
        type: parseType[0],
        enums: parseType[1].split(",")
    }
}

function fileFormat(comments) {

    let route, parameters = {}, params = [], tags = [], definitions = {};
    for (let i in comments) {
        let desc = parseDescription(comments);
        if (i == 'tags') {
            if (comments[i].length > 0 && comments[i][0]['title'] && comments[i][0]['title'] == 'typedef') {

                const typedefParsed = parseTypedef(comments[i]);
                definitions[typedefParsed.typeName] = typedefParsed.details;
                continue;
            }
            for (let j in comments[i]) {
                let title = comments[i][j]['title']
                if (title == 'route') {
                    route = parseRoute(comments[i][j]['description'])
                    let tag = parseTag(comments[i])
                    parameters[route.uri] = parameters[route.uri] || {}
                    parameters[route.uri][route.method] = parameters[route.uri][route.method] || {}
                    parameters[route.uri][route.method]['parameters'] = []
                    parameters[route.uri][route.method]['description'] = desc
                    parameters[route.uri][route.method]['tags'] = [tag[0].trim()]
                    tags.push({
                        name: typeof tag[0] === 'string' ? tag[0].trim() : '',
                        description: typeof tag[1] === 'string' ? tag[1].trim() : ''
                    })
                }
                if (title == 'param') {
                    let field = parseField(comments[i][j]['name']),
                        properties = {
                            name: field.name,
                            in: field.parameter_type,
                            description: comments[i][j]['description'],
                            required: field.required
                        },
                        schema = parseSchema(comments[i][j]['type'])
                    // we only want a type if there is no referenced schema
                    if (!schema) {
                        properties.type = parseType(comments[i][j]['type'])
                        if(properties.type === 'enum') {
                            let parsedEnum = parseEnums(comments[i][j]['description'])
                            properties.type = parsedEnum.type;
                            properties.enum = parsedEnum.enums;
                        }
                    } else
                        properties.schema = schema
                    params.push(properties)
                }

                if (title == 'operationId' && route) {
                    parameters[route.uri][route.method]['operationId'] = comments[i][j]['description'];
                }

                if (title == 'summary' && route) {
                    parameters[route.uri][route.method]['summary'] = comments[i][j]['description'];
                }

                if (title == 'produces' && route) {
                    parameters[route.uri][route.method]['produces'] = parseProduces(comments[i][j]['description']);
                }

                if (title == 'consumes' && route) {
                    parameters[route.uri][route.method]['consumes'] = parseConsumes(comments[i][j]['description']);
                }

                if (title == 'security' && route) {
                    parameters[route.uri][route.method]['security'] = parseSecurity(comments[i][j]['description'])
                }

                if (title == 'deprecated' && route) {
                    parameters[route.uri][route.method]['deprecated'] = true;
                }

                if (route) {
                    parameters[route.uri][route.method]['parameters'] = params;
                    parameters[route.uri][route.method]['responses'] = parseReturn(comments[i]);
                }
            }
        }
    }
    return {parameters: parameters, tags: tags, definitions: definitions}
}

/**
 * Filters JSDoc comments
 * @function
 * @param {object} jsDocComments - JSDoc comments
 * @returns {object} JSDoc comments
 * @requires js-yaml
 */
function filterJsDocComments(jsDocComments) {
    return jsDocComments.filter(function (item) {
        return item.tags.length > 0
    })
}

/**
 * Converts an array of globs to full paths
 * @function
 * @param {array} globs - Array of globs and/or normal paths
 * @return {array} Array of fully-qualified paths
 * @requires glob
 */
function convertGlobPaths(base, globs) {
    return globs.reduce(function (acc, globString) {
        let globFiles = glob.sync(path.resolve(base, globString));
        return acc.concat(globFiles);
    }, []);
}

/**
 * Generates the swagger spec
 * @function
 * @returns {array} Swagger spec
 * @requires swagger-parser
 */
module.exports = function (options) {
    /* istanbul ignore if */
    if (!options) {
        throw new Error('\'options\' is required.');
    } else /* istanbul ignore if */ if (!options.swaggerDefinition) {
        throw new Error('\'swaggerDefinition\' is required.');
    } else /* istanbul ignore if */ if (!options.files) {
        throw new Error('\'files\' is required.');
    }

    // Build basic swagger json
    let swaggerObject = swaggerHelpers.swaggerizeObj(options.swaggerDefinition);
    let apiFiles = convertGlobPaths(options.basedir, options.files);

    // Parse the documentation in the APIs array.
    for (let i = 0; i < apiFiles.length; i = i + 1) {
        let parsedFile = parseApiFile(apiFiles[i]);
        //console.log(JSON.stringify(parsedFile))
        let comments = filterJsDocComments(parsedFile);

        for (let j in comments) {

            let parsed = fileFormat(comments[j])
            swaggerHelpers.addDataToSwaggerObject(swaggerObject, [{
                paths: parsed.parameters,
                tags: parsed.tags,
                definitions: parsed.definitions
            }]);
        }
    }
    parser.parse(swaggerObject, function (err, api) {
        if (!err) {
            swaggerObject = api;
        }
    });

    return swaggerObject;
};