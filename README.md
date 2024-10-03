# ReGit
ReGit is a Requirement Management Tool for google docs.

# Use a google sheet document as database
Create a google sheet document
Rename a sheet as "DB"
Insert following column names in the row 1: ID, Description, Location, Parents, Childs, Ver, State

# Connect to the database
Create a google docs document
Create anywhere in the document a simple table
| #DB          | https://docs.google.com/spreadsheets/d/tHeL0ngH4ashT0th3fil3/edit |
| ------------ | ----------------------------------------------------------------- |

# Create a requirement
Insert a simple table
| #ID          | ReqID1 |
| ------------ | ------ |
| #Description |        |
| #State       | Open   |

The table can have any random shape. If a cell begins with hash (#) it is a variable of the requirement. The neighbor on the right side contains the data for the variable.

# Push/pull the requirement
Use the menu items to push or pull the requirement from database
