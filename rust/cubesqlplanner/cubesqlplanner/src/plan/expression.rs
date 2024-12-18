use crate::planner::{BaseMember, VisitorContext};
use cubenativeutils::CubeError;
use std::rc::Rc;

#[derive(Clone)]
pub enum Expr {
    Field(Rc<dyn BaseMember>),
    Reference(Option<String>, String),
    Asterix,
}

impl Expr {
    pub fn to_sql(&self, context: Rc<VisitorContext>) -> Result<String, CubeError> {
        match self {
            Expr::Field(field) => field.to_sql(context),
            Expr::Reference(cube_alias, field_alias) => {
                if let Some(cube_alias) = cube_alias {
                    Ok(format!("{}.{}", cube_alias, field_alias))
                } else {
                    Ok(field_alias.clone())
                }
            }
            Expr::Asterix => Ok("*".to_string()),
        }
    }
}
